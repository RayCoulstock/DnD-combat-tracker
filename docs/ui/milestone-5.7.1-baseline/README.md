# Floor inspector visual review

Captured from the local implementation on 4 November 2026 using Chromium and synthetic maps; production was not accessed.

- `inspector-1440.png` and `inspector-768.png`: the actual Floor Surface form cropped from 1440×1000 and 768×1024 viewports. Fields remain stacked, text readable and actions wrapped within the available inspector width.
- `picker-768.png`: native top-layer texture picker at tablet width, including the selected marker, independent search/filter layout and six starter cards. It does not alter the inspector/canvas geometry.

The captures were visually inspected. Automated layout coverage additionally measures label height, control widths, containment and vertical separation at 1600/1280/768px; keyboard tests cover search, Escape and focus return. These are implementation evidence, not claims of production screenshots or cross-browser certification.
