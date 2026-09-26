#!/usr/bin/env python3
"""Regenerate the 'scan to enquire' QR code for the land & properties TV ad.

Usage:
    python3 make-qr.py "https://wa.me/2348012345678?text=Hi, I saw your property on the screen"

Then refresh the TV page. Pass any URL you like (a WhatsApp link, a website,
a Google Maps pin, etc.). With no argument it uses the placeholder below.
"""
import sys, segno

DEFAULT = "https://wa.me/2340000000000?text=Hi%2C%20I%20saw%20your%20property%20on%20the%20screen"

url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
qr = segno.make(url, error="m")
qr.save("enquiry-qr.svg", scale=10, border=2, dark="#0f2e22", light="#ffffff")
print("Wrote enquiry-qr.svg for:", url)
