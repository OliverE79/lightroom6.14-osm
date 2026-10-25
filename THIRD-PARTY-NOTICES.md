# Third-party notices

## Lua bytecode string patcher

[patchluastr.py](patchluastr.py) comes from
[astuder/lightroom-map-fix](https://github.com/astuder/lightroom-map-fix).

Copyright (c) 2018-2020 Adrian Studer.

The MIT permission notice and disclaimer are preserved in that source file.

## Leaflet 1.9.4

The vendored Leaflet distribution is in
[osm/vendor/leaflet/](osm/vendor/leaflet/).

Copyright (c) 2010-2023, Volodymyr Agafonkin.
Copyright (c) 2010-2011, CloudMade.

Leaflet is distributed under the
[BSD-2-Clause license](osm/vendor/leaflet/LICENSE). Its license text is included
alongside the JavaScript and CSS.

## Adobe Lightroom

Adobe Lightroom and its original resources are not included. The build requires
a module supplied from the user's own Lightroom installation and retains
original resources in the locally produced output.

No rights to distribute Adobe's original or modified module are granted by this
repository. The licenses above apply only to their respective components.

## OpenStreetMap

Map tiles are requested at runtime; they are not bundled in this repository.
OpenStreetMap data licensing and attribution are described at
[openstreetmap.org/copyright](https://www.openstreetmap.org/copyright), and use
of the default tile server is subject to the
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
