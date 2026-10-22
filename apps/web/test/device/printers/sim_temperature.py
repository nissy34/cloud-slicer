# Pretend temperature sensors for the simulated test printers.
#
# The simulated control board reads one fixed number from every thermistor,
# so a real heater never warms up and Klipper shuts down ("not heating at
# expected rate"). This sensor instead works out the temperature from how
# hard Klipper drives the heater: full power warms it, the room cools it.
# A sensor with no heater (a chamber) follows the warmest heater slowly.
#
#   [sim_temperature]            # load this file first, before any heater
#   [extruder]
#   sensor_type: sim
#   sim_heat_rate: 6             # degrees per second at full power
#   sim_loss: 0.02               # share of the gap to the room lost per second
#
# This file may be distributed under the terms of the GNU GPLv3 license.

REPORT_TIME = 0.3
ROOM = 24.0


class SimTemperature:
    def __init__(self, config):
        self.printer = config.get_printer()
        self.reactor = self.printer.get_reactor()
        self.name = config.get_name().split()[-1]
        self.heat_rate = config.getfloat('sim_heat_rate', 6., above=0.)
        self.loss = config.getfloat('sim_loss', 0.02, above=0.)
        self.temp = config.getfloat('sim_start', ROOM)
        self.min_temp = self.max_temp = 0.
        self.heater = None
        self.callback = None
        self.timer = self.reactor.register_timer(self._tick)
        self.printer.register_event_handler('klippy:connect', self._connect)

    def _connect(self):
        heaters = self.printer.lookup_object('heaters')
        self.heater = heaters.heaters.get(self.name)
        self.reactor.update_timer(self.timer, self.reactor.NOW)

    def setup_minmax(self, min_temp, max_temp):
        self.min_temp, self.max_temp = min_temp, max_temp

    def setup_callback(self, cb):
        self.callback = cb

    def get_report_time_delta(self):
        return REPORT_TIME

    def _power(self, eventtime):
        if self.heater is not None:
            return self.heater.get_status(eventtime)['power']
        return 0.

    def _tick(self, eventtime):
        power = self._power(eventtime)
        if self.heater is None:
            # No heater of its own: drift toward the warmest heater, far behind it.
            temps = [h.get_status(eventtime)['temperature'] for h in self.printer.lookup_object('heaters').heaters.values()]
            goal = ROOM + (max(temps) - ROOM) * 0.15 if temps else ROOM
            self.temp += (goal - self.temp) * 0.02
        else:
            self.temp += (power * self.heat_rate - (self.temp - ROOM) * self.loss) * REPORT_TIME
        if self.callback is not None:
            mcu = self.printer.lookup_object('mcu')
            self.callback(mcu.estimated_print_time(eventtime), self.temp)
        return eventtime + REPORT_TIME

    def get_status(self, eventtime):
        return {'temperature': round(self.temp, 2)}


class SimTemperatureLoader:
    def __init__(self, config):
        heaters = config.get_printer().load_object(config, 'heaters')
        heaters.add_sensor_factory('sim', SimTemperature)


def load_config(config):
    return SimTemperatureLoader(config)
