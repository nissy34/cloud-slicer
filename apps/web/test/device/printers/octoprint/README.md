# Pretend OctoPrint printer

The real OctoPrint with its built-in virtual printer, for testing the Device tab
with a printer run by OctoPrint (`test/device-octoprint.mjs`). Heaters warm up, moves
answer like Marlin, prints take real time; nothing reaches real hardware.

- API key: `CLOUDSLICERTESTKEY0123456789ABCD` (OctoPrint user `maker`, password `test-pass`).
- Its camera is OctoPrint's own logo.

Run it with OctoPrint installed by pip (`pip install OctoPrint==1.11.8`):

```sh
test/device/printers/octoprint/start.sh /tmp/octoprint 7140
```

or in Docker: `docker build -t pretend-octoprint . && docker run -p 7140:7140 pretend-octoprint`.
Then add `127.0.0.1:7140` in the Device tab (through the bridge) with the key above.
Every start begins again from `config.yaml`, `users.yaml` and `keys.yaml`.
