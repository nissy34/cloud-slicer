#!/bin/sh
# Starts the pretend OctoPrint printer: start.sh <data folder> <port> [octoprint program]
# Every start begins from the settings in this folder (OctoPrint rewrites its own copy).
set -e
here=$(cd "$(dirname "$0")" && pwd)
base=$1
port=${2:-7140}
octoprint=${3:-octoprint}
rm -rf "$base"
mkdir -p "$base/data/appkeys"
cp "$here/config.yaml" "$here/users.yaml" "$base/"
cp "$here/keys.yaml" "$base/data/appkeys/keys.yaml"
exec "$octoprint" --basedir "$base" serve --iknowwhatimdoing --host 0.0.0.0 --port "$port"
