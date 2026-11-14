# Features

A short tour of what Cloud Slicer does. Every option, key and limit:
[features-in-detail.md](features-in-detail.md). How each part is built:
[the docs map](README.md).

## Slicing

- The real OrcaSlicer engine, running in your browser tab: G-code like desktop's.
- Two engines, picked per project: **Snapmaker Orca 2.4.1** or **OrcaSlicer 2.5**.
- Opens STL, OBJ, AMF, STEP and 3MF, including Bambu Studio projects with painted colours.
- Slicing runs in the background, can be cancelled, and each plate keeps its own slice.
- Warnings like desktop's: objects off the plate, empty layers, collisions, risky settings.

## Printers and presets

- Every printer brand the engine ships (55 in Snapmaker Orca, 63 in OrcaSlicer).
- A setup wizard picks your printers and filaments the first time.
- Desktop's settings pages, with Simple, Advanced and Expert levels and a search box.
- Your own presets, shared between both engines, and desktop's preset files in and out.
- Calibration tests: temperature, flow rate, pressure advance, retraction, and more.

## Prepare

- Move, rotate, scale, lay on face, cut, measure, mirror, split, simplify.
- Arrange, auto-orient, clone, and **Fill plate** with copies.
- Painting: colours, supports, seams and fuzzy skin.
- Parts, negative parts and modifiers, mesh boolean, text and SVG shapes, Assemble.
- Variable layer height, brim ears, plates with their own settings, a draggable prime tower.
- Desktop's keyboard shortcuts and right-click menus; long press on a phone.

## Colours and filaments

- As many filaments as the file has or you add.
- **Colour mixing**: blend filaments into a new colour, or match a colour you pick.
- **From printer** loads the filaments in a U1's tool heads or a Bambu AMS.
- Flushing volumes for single-nozzle multi-colour printers, like desktop's window.

## Preview

- Desktop's views: line type, filament, speed, layer height, width, flow, layer time, fan,
  temperature.
- Grams, metres and cost per filament, filament changes and print time.
- Pauses, filament changes and custom G-code at any layer.

## Projects and accounts

- Save as an Orca 3MF that reopens here or in desktop Orca.
- Sign in with Google: projects go to your own Google Drive, presets and printers follow you.
- Open models from Google Drive, or share one to the app on Android.
- AutoSave keeps unsaved work in the browser; **Continue** picks up on another device.
- No sign-in needed: everything stays in the browser and Save downloads the 3MF.

## Device tab

- Klipper printers (including the Snapmaker U1), Prusa through PrusaLink, OctoPrint, the
  Elegoo Centauri Carbon and Bambu Lab.
- Cameras, temperatures, fans, moves, console, files with pictures, upload and print.
- Pause, cancel and skip objects during a print; timelapses; which plates you printed.
- Print alerts on your phone when a print fails, runs out of filament or finishes.
- Printers at home are reached through a small bridge app, which can run on the printer.

## Slice from an AI app

- A Claude Desktop add-on: open models, slice and run your printers from a chat.
- It asks you before anything heats, moves or starts printing.

## The app

- Works on a computer, a tablet and a phone, with tabs at the bottom on phones.
- Installable on Android, light and dark theme, more than one language.
- Free, open source, no telemetry. Errors show with a Copy button.
