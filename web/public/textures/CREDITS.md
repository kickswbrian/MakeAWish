# Texture and HDRI credits

Every asset here is CC0 (public domain). No attribution is required, but we credit the authors anyway.

Scanned sets were processed for the tintable preset library: the color map became a neutral luminance
"detail" map (`albedo.jpg`), the normal map (OpenGL) was rescaled to a common strength (`normal.jpg`),
and AO + roughness were packed as `orm.jpg` (R = AO, G = roughness normalized to mean 0.75).

| Folder | Presets | Source asset | URL | License |
|---|---|---|---|---|
| `nylon/` | nylon | ambientCG Fabric061 | https://ambientcg.com/view?id=Fabric061 | CC0 |
| `leather/` | leather | Poly Haven leather_white | https://polyhaven.com/a/leather_white | CC0 |
| `canvas/` | canvas | Poly Haven hessian_230 | https://polyhaven.com/a/hessian_230 | CC0 |
| `cotton/` | cotton | Poly Haven rough_linen | https://polyhaven.com/a/rough_linen | CC0 |
| `knit/` | knit | Poly Haven knitted_fleece | https://polyhaven.com/a/knitted_fleece | CC0 |
| `satin/` | satin | Poly Haven terlenka | https://polyhaven.com/a/terlenka | CC0 |
| `denim/` | denim | Poly Haven denim_fabric_03 | https://polyhaven.com/a/denim_fabric_03 | CC0 |
| `suede/` | suede | Poly Haven scuba_suede | https://polyhaven.com/a/scuba_suede | CC0 |
| `wood/` | wood | Poly Haven oak_veneer_01 | https://polyhaven.com/a/oak_veneer_01 | CC0 |
| `marble/` | marble | ambientCG Marble001 | https://ambientcg.com/view?id=Marble001 | CC0 |
| `concrete/` | concrete | ambientCG Concrete016 | https://ambientcg.com/view?id=Concrete016 | CC0 |
| `cork/` | cork | ambientCG Cork004 | https://ambientcg.com/view?id=Cork004 | CC0 |
| `metal_brushed/` | metal_brushed | Procedural (generated for Wish it) | n/a | CC0 |
| `plastic_matte/` | plastic_matte | Procedural bead-blast stipple (generated for Wish it) | n/a | CC0 |
| `rubber/` | rubber | Procedural stipple (generated for Wish it) | n/a | CC0 |
| `smooth/` | plastic_gloss, ceramic, glass, metal_polished, pearl, gem | Procedural orange peel + smudge roughness (generated for Wish it) | n/a | CC0 |
| `jersey/` | jersey | Poly Haven jersey_melange (heather contrast reduced) | https://polyhaven.com/a/jersey_melange | CC0 |
| `fleece/` | fleece | Poly Haven polar_fleece | https://polyhaven.com/a/polar_fleece | CC0 |
| `sherpa/` | sherpa | Poly Haven curly_teddy_natural | https://polyhaven.com/a/curly_teddy_natural | CC0 |
| `linen/` | linen | Poly Haven rough_linen (same scan as `cotton/`, kept slubbier and at true scale) | https://polyhaven.com/a/rough_linen | CC0 |
| `tweed/` | tweed | Poly Haven wool_boucle (non-square: tile 0.315 x 0.39 m) | https://polyhaven.com/a/wool_boucle | CC0 |
| `corduroy/` | corduroy | Poly Haven ribbed_corduroy | https://polyhaven.com/a/ribbed_corduroy | CC0 |
| `velvet/` | velvet | Poly Haven velour_velvet | https://polyhaven.com/a/velour_velvet | CC0 |
| `denim_light/` | denim_light | Poly Haven denmin_fabric_02 (faded twill) | https://polyhaven.com/a/denmin_fabric_02 | CC0 |
| `leather_pebbled/` | leather_pebbled | Poly Haven leather_red_02 | https://polyhaven.com/a/leather_red_02 | CC0 |
| `patent/` | patent_leather | Poly Haven leather_red_03 (normal blurred to a faint undulation under the coat) | https://polyhaven.com/a/leather_red_03 | CC0 |
| `gingham/` | gingham | Poly Haven gingham_check, re-encoded as a dye map (R = coverage, G = weave shading; see below) | https://polyhaven.com/a/gingham_check | CC0 |
| `wool_suiting/` | wool_suiting | Procedural 2/2 broken herringbone twill, dark warp x light weft (generated for Wish it) | n/a | CC0 |
| `rib_knit/` | rib_knit | Procedural 2x2 rib: knit V columns over purl troughs (generated for Wish it) | n/a | CC0 |
| `cable_knit/` | cable_knit | Procedural rope cables in purl channels, twisted rib, moss stitch (generated for Wish it) | n/a | CC0 |
| `mesh_fabric/` | mesh_fabric | Procedural knitted hex mesh + `alpha.jpg` (generated for Wish it) | n/a | CC0 |
| `lace/` | lace | Procedural Chantilly-style floral lace on hex tulle + `alpha.jpg` (generated for Wish it) | n/a | CC0 |
| `quilted/` | quilted | Procedural diamond quilting: puffy cells, stitched channels, creases (generated for Wish it) | n/a | CC0 |
| `horn/` | horn | Procedural mottled horn streaks (generated for Wish it) | n/a | CC0 |

Special maps:
- `alpha.jpg` (lace, mesh_fabric): openwork coverage, alpha-blended with a small alphaTest; the material is drawn
  double sided with dimmed back faces.
- `gingham/albedo.jpg` is not a luminance map: R = dye coverage (0 undyed, 0.5 one dyed yarn, 1 both), G/B = weave
  shading. The preset's dye shader mixes undyed white with the part color, so the white squares stay white.
- Procedural sets come from numpy scripts (FFT-filtered noise, stitch/float height fields, cavity AO) and are tileable
  at 1024 px. Scanned sets were resized from the Poly Haven 2k maps to 1024 px (tileable as published).

## HDRI

| File | Source asset | URL | License |
|---|---|---|---|
| `../hdri/studio.hdr` | Poly Haven studio_small_08 (1k), white-balanced to neutral | https://polyhaven.com/a/studio_small_08 | CC0 |

Poly Haven: https://polyhaven.com/license. ambientCG: https://docs.ambientcg.com/license/.
