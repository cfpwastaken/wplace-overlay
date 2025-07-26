const RadiusToCircumference = 2 * Math.PI * 6378137 / 2;

export class GeospatialConverter {
	tileSize;
	initialResolution;
  constructor(tileSizePixels = 256) {
    this.tileSize = tileSizePixels,
    this.initialResolution = 2 * RadiusToCircumference / this.tileSize
  }
  latLonToMeters(lat: number, lon: number): [number, number] {
    const metersX = lon / 180 * RadiusToCircumference,
    metersY = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * RadiusToCircumference / 180;
    return [metersX,
    metersY]
  }
  metersToLatLon(metersX: number, metersY: number): [number, number] {
    const lon = metersX / RadiusToCircumference * 180;
    let lat = metersY / RadiusToCircumference * 180;
    lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
    return [lat, lon];
  }
  pixelsToMeters(pixelX: number, pixelY: number, zoomLevel: number): [number, number] {
    const resolution = this.resolution(zoomLevel),
    metersX = pixelX * resolution - RadiusToCircumference,
    metersY = RadiusToCircumference - pixelY * resolution;
    return [metersX,
    metersY]
  }
  pixelsToLatLon(pixelX: number, pixelY: number, zoomLevel: number) {
    const [metersX,
    metersY] = this.pixelsToMeters(pixelX, pixelY, zoomLevel);
    return this.metersToLatLon(metersX, metersY)
  }
  latLonToPixels(lat: number, lon: number, zoomLevel: number): [number, number] {
    const [metersX,
    metersY] = this.latLonToMeters(lat, lon);
    return this.metersToPixels(metersX, metersY, zoomLevel)
  }
  latLonToPixelsFloor(lat: number, lon: number, zoomLevel: number): [number, number] {
    const [pixelX,
    pixelY] = this.latLonToPixels(lat, lon, zoomLevel);
    return [Math.floor(pixelX),
    Math.floor(pixelY)]
  }
  metersToPixels(metersX: number, metersY: number, zoomLevel: number): [number, number] {
    const resolution = this.resolution(zoomLevel),
    pixelX = (metersX + RadiusToCircumference) / resolution,
    pixelY = (RadiusToCircumference - metersY) / resolution;
    return [pixelX,
    pixelY]
  }
  latLonToTile(lat: number, lon: number, zoomLevel: number) {
    const [metersX,
    metersY] = this.latLonToMeters(lat, lon);
    return this.metersToTile(metersX, metersY, zoomLevel)
  }
  metersToTile(metersX: number, metersY: number, zoomLevel: number): [number, number] {
    const [pixelX,
    pixelY] = this.metersToPixels(metersX, metersY, zoomLevel);
    return this.pixelsToTile(pixelX, pixelY)
  }
  pixelsToTile(pixelX: number, pixelY: number): [number, number] {
    const tileX = Math.ceil(pixelX / this.tileSize) - 1,
    tileY = Math.ceil(pixelY / this.tileSize) - 1;
    return [tileX,
    tileY]
  }
  pixelsToTileLocal(pixelX: number, pixelY: number) {
    return {
      tile: this.pixelsToTile(pixelX, pixelY),
      pixel: [
        Math.floor(pixelX) % this.tileSize,
        Math.floor(pixelY) % this.tileSize
      ]
    }
  }
  tileBounds(tileX: number, tileY: number, zoomLevel: number) {
    const [minMetersX,
    minMetersY] = this.pixelsToMeters(tileX * this.tileSize, tileY * this.tileSize, zoomLevel),
    [
      maxMetersX,
      maxMetersY
    ] = this.pixelsToMeters((tileX + 1) * this.tileSize, (tileY + 1) * this.tileSize, zoomLevel);
    return {
      min: [minMetersX, minMetersY] as [number, number],
      max: [maxMetersX, maxMetersY] as [number, number]
    }
  }
  tileBoundsLatLon(tileX: number, tileY: number, zoomLevel: number) {
    const bounds = this.tileBounds(tileX, tileY, zoomLevel);
    return {
      min: this.metersToLatLon(bounds.min[0], bounds.min[1]),
      max: this.metersToLatLon(bounds.max[0], bounds.max[1])
    }
  }
  resolution(zoomLevel: number) {
    return this.initialResolution / 2**zoomLevel
  }
  latLonToTileAndPixel(lat: number, lon: number, zoomLevel: number) {
    const [metersX,
    metersY] = this.latLonToMeters(lat, lon),
    [
			tileX,
      tileY
    ] = this.metersToTile(metersX, metersY, zoomLevel),
    [
			pixelX,
      pixelY
    ] = this.metersToPixels(metersX, metersY, zoomLevel);
    return {
      tile: [
        tileX,
        tileY
      ],
      pixel: [
        Math.floor(pixelX) % this.tileSize,
        Math.floor(pixelY) % this.tileSize
      ]
    }
  }
  pixelBounds(pixelX: number, pixelY: number, zoomLevel: number) {
    return {
      min: this.pixelsToMeters(pixelX, pixelY, zoomLevel),
      max: this.pixelsToMeters(pixelX + 1, pixelY + 1, zoomLevel)
    }
  }
  pixelToBoundsLatLon(pixelX: number, pixelY: number, zoomLevel: number) {
    const bounds = this.pixelBounds(pixelX, pixelY, zoomLevel),
    adjustment = 0.001885,
    adjustmentX = (bounds.max[0] - bounds.min[0]) * adjustment,
    adjustmentY = (bounds.max[1] - bounds.min[1]) * adjustment;
    return bounds.min[0] -= adjustmentX,
    bounds.max[0] -= adjustmentX,
    bounds.min[1] -= adjustmentY,
    bounds.max[1] -= adjustmentY,
    {
      min: this.metersToLatLon(bounds.min[0], bounds.min[1]),
      max: this.metersToLatLon(bounds.max[0], bounds.max[1])
    }
  }
  latLonToTileBoundsLatLon(lat: number, lon: number, zoomLevel: number) {
    const [metersX,
    metersY] = this.latLonToMeters(lat, lon),
    [
      tileX,
      tileY
    ] = this.metersToTile(metersX, metersY, zoomLevel);
    return this.tileBoundsLatLon(tileX, tileY, zoomLevel)
  }
  latLonToPixelBoundsLatLon(lat: number, lon: number, zoomLevel: number) {
    const [metersX,
    metersY] = this.latLonToMeters(lat, lon),
    [
      pixelX,
      pixelY
    ] = this.metersToPixels(metersX, metersY, zoomLevel);
    return this.pixelToBoundsLatLon(Math.floor(pixelX), Math.floor(pixelY), zoomLevel)
  }
  latLonToRegionAndPixel(lat: number, lon: number, zoomLevel: number, regionSize: number = 1) {
    const [pixelX,
    pixelY] = this.latLonToPixelsFloor(lat, lon, zoomLevel),
    regionPixelSize = this.tileSize * regionSize;
    return {
      region: [
        Math.floor(pixelX / regionPixelSize),
        Math.floor(pixelY / regionPixelSize)
      ],
      pixel: [
        pixelX % regionPixelSize,
        pixelY % regionPixelSize
      ]
    }
  }
}