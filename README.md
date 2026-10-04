# quake3-concat-demos

Concatenate (merge, combine) Quake 3 demos: pick the parts of a recording
(`.dm_68` and the like), put them in playback order, get one demo.
Parts of the same game recorded back to back are joined seamlessly;
anything else is joined with a level reload in between. Nothing is uploaded.
This might be useful if you did `\stoprecord` with `\set cl_autoRecordDemo 1`.

(AI-generated).

## Notes

It probably would have been simpler to reuse the engine code
and compile it with Emscripten
instead of reimplementing everything in JavaScript?

## Similar projects

Some seem to have a "merge" feature, but it's about merging the same game
from multiple PoVs.

- UberDemoTools on GitHub (https://github.com/mightycow/uberdemotools)
- UHDk1ng Quake III Demo Converter on ModDB (https://www.moddb.com/downloads/uhdk1ng-quake-iii-demo-converter-v120260829windows-x64)
- TomArrow/jk2DemoCutter (https://github.com/TomArrow/jk2DemoCutter)
- WolfcamQL (https://github.com/brugal/wolfcamql)
