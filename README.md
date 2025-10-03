# World Rivers 3D Globe

An interactive 3D globe displaying the world’s major rivers, built with  
[globe.gl](https://github.com/vasturiano/globe.gl) and [Three.js](https://threejs.org/).  
The rivers come from Natural Earth datasets and the popups are enriched with Wikipedia (via Wikidata IDs).

## Features
- 3D interactive globe (rotatable, zoomable).
- Major rivers styled by relative size.
- Popups with information from Wikipedia (length, width, countries, description).
- Filter rivers by length with a slider.
- Reset button to return to world view.

## Data Sources
- Natural Earth: [10m Rivers + Lake Centerlines](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-rivers-lake-centerlines/)  
- Wikipedia / Wikidata: linked via river `wikidataid`.
- NASA Visible Earth: [Bathymetry](https://visibleearth.nasa.gov/images/73963/bathymetry) (edited version used as basemap).

## Live Demo
Link: https://monica-alegre.github.io/world-rivers-globe/

## License
- Natural Earth data is in the public domain.  
- Wikipedia extracts under CC-BY-SA 3.0.
- Project code and integration: CC-BY-NC 4.0.