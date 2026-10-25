"""Write a Win32 .res file from raw resource files.

Resource Hacker's .rc compiler rejects resource names containing a dot
(e.g. MARKERCLUSTERER.JS), so the .res file is generated here and merged
into the module with "ResourceHacker -action addoverwrite -mask ,,".

Usage: make_res.py OUTPUT.res TYPE NAME FILE [TYPE NAME FILE ...] [--lang 1033]
"""
import argparse
import struct


def res_string(value):
    return value.upper().encode("utf-16-le") + b"\0\0"


def pad4(data):
    return data + b"\0" * (-len(data) % 4)


def res_entry(res_type, name, data, lang):
    header = res_string(res_type) + res_string(name)
    header = pad4(header)
    header += struct.pack("<IHHII", 0, 0x1030, lang, 0, 0)
    header_size = 8 + len(header)
    return pad4(struct.pack("<II", len(data), header_size) + header + data)


def main():
    parser = argparse.ArgumentParser(description="Write a Win32 .res file from raw resource files.")
    parser.add_argument("output")
    parser.add_argument("resources", nargs="+", help="TYPE NAME FILE triples")
    parser.add_argument("--lang", type=int, default=1033)
    args = parser.parse_args()

    if len(args.resources) % 3:
        parser.error("resources must be given as TYPE NAME FILE triples")

    # A .res file starts with an empty 32 byte entry.
    out = struct.pack("<IIHHHHIHHII", 0, 32, 0xFFFF, 0, 0xFFFF, 0, 0, 0, 0, 0, 0)
    for i in range(0, len(args.resources), 3):
        res_type, name, path = args.resources[i:i + 3]
        with open(path, "rb") as f:
            out += res_entry(res_type, name, f.read(), args.lang)

    with open(args.output, "wb") as f:
        f.write(out)


if __name__ == "__main__":
    main()
