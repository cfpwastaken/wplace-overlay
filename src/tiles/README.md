# Overlay Tiles

This directory contains folders for each tile column, which contain files for each tile row.

Each folder has a `_orig.png` file that is the overlay tile image (for editing) and a generated `.png` file (no suffix) that is the processed tile image (which is overlaid on the current tiles on wplace).

After editing the `_orig.png` file, run the following command to regenerate the processed tile image:

```bash
python3 border.py a/b # (path, no file extension)
```

(requires Python 3 and Pillow library)
