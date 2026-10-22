# Pretend printers

Three Klipper printers that run in Docker, for trying the Device tab without a
real printer. Each one is the real Klipper and the real Moonraker on a
simulated control board, so the page talks to them exactly as it talks to a
real Klipper printer. Nothing moves and nothing heats: motors, heaters and
fans are numbers in the simulation.

| Printer    | Address                 | What it has                                              |
| ---------- | ----------------------- | -------------------------------------------------------- |
| one-head   | `http://127.0.0.1:7131` | 1 head, no heated bed, one camera, 180 mm bed            |
| two-heads  | `http://127.0.0.1:7132` | 2 heads (T0, T1), heated bed, two cameras                |
| four-heads | `http://127.0.0.1:7134` | 4 heads (T0 to T3), heated bed, chamber, no camera, 270 mm bed |

They don't have the U1's own parts (docked heads, feeders, its camera, its
error codes). Those are tested against our own pretend U1,
[`../mock-printer.mjs`](../mock-printer.mjs).

## On your computer

1. Install Docker Desktop (Windows, Mac) or Docker (Linux) and start it.
2. In a terminal, in this folder:
   ```
   docker compose up -d --wait
   ```
   The first start downloads about 400 MB.
3. In Cloud Slicer: Device tab, Add a printer, Over the internet (advanced),
   and type one of the addresses above. Use `127.0.0.1`, not `localhost`:
   the cameras are set up on `127.0.0.1`, and a bridge only opens cameras on
   the printer's own address.
4. When you're done: `docker compose down`.

You can also add them through your bridge, if it runs on the same computer.

## The automatic test

`node test/device-klipper.mjs` (from `apps/web`, after `npm run build`) adds
all three in a browser and checks, against what Klipper itself reports:
temperatures set on the page heat the heater, Home all and jog move the head,
the console shows Klipper's replies, a file goes up with its picture and
prints to the end, skip object, pause, resume and cancel, a print that uses
all four heads, the phone layout, and the two-heads printer once more through
the bridge. CI runs it in the "Device" workflow, job "Real Klipper printers".

## How they work

- `docker-compose.yml`: the three printers. The image is
  [`ei99070/docker-klipper-simulavr`](https://hub.docker.com/r/ei99070/docker-klipper-simulavr)
  by Pedro Lamas (who maintains Fluidd), rebuilt from upstream Klipper and
  Moonraker.
- `common.cfg`: what every printer shares (board, motion, macros).
  `<printer>/printer.cfg` adds its heads, bed and size; `<printer>/moonraker.conf`
  its cameras.
- `sim_temperature.py`: a Klipper add-on that makes heaters warm up. The
  simulated board reads a fixed number from every thermometer, so without it
  a heater never warms and Klipper stops with "not heating at expected rate".
- The simulated board runs as fast as the computer lets it (each one keeps a
  processor core busy), and the motors use no microsteps so Klipper keeps up.
  Slowed down on purpose (`SIMULAVR_PACING_RATE`), it can get too slow for
  Klipper to connect ("Timeout on connect").
- `FIRMWARE_RESTART` hangs the simulated board; use `RESTART`, or
  `docker compose restart`.

To add a printer shape: copy a folder, change `printer.cfg` and
`moonraker.conf`, add a service with new ports to `docker-compose.yml`, and add
it to `PRINTERS` in `test/device-klipper.mjs`.
