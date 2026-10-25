/*
 * Google Maps API v3 compatibility shim for Lightroom 6 / Lightroom CC 2015.
 *
 * Implements the subset of the google.maps API used by Lightroom's Location
 * module (LOCATIONMAPVIEW, LOCATIONNAVIGATORVIEW, MARKERCLUSTERER.JS and
 * KEYDRAGZOOM.JS) on top of Leaflet, using OpenStreetMap tiles.
 *
 * Must stay ES5: Lightroom 6.14 embeds CEF 3.2704 (Chromium 51).
 */
(function (window, document, L) {
	'use strict';

	if (!L) {
		return;
	}

	// Replaced by build-osm-module.ps1 when -TileUrl is given.
	var TILE_URL = '__OSM_TILE_URL__';
	if (TILE_URL.indexOf('__') === 0) {
		TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
	}
	var TILE_ATTRIBUTION = '\u00a9 OpenStreetMap contributors';
	var MAX_ZOOM = 19;
	var MAX_LAT = 85.0511287798;

	var slice = Array.prototype.slice;

	function hidden(obj, key, value) {
		Object.defineProperty(obj, key, { value: value, writable: true, configurable: true, enumerable: false });
		return value;
	}

	function clamp(v, lo, hi) {
		return Math.max(lo, Math.min(hi, v));
	}

	function wrapLng(lng) {
		if (lng === 180) {
			return 180;
		}
		return ((((lng + 180) % 360) + 360) % 360) - 180;
	}

	function capitalize(s) {
		return s.charAt(0).toUpperCase() + s.slice(1);
	}

	function later(fn) {
		return window.setTimeout(fn, 0);
	}

	function markOverlayEvent(e) {
		if (e && e.originalEvent) {
			e.originalEvent.__gmOverlayEvent = true;
		}
	}

	// ------------------------------------------------------------------
	// Events
	// ------------------------------------------------------------------

	function listenerList(obj, name, create) {
		if (!obj) {
			return null;
		}
		var all = obj.__gm_listeners__;
		if (!all) {
			if (!create) {
				return null;
			}
			all = hidden(obj, '__gm_listeners__', {});
		}
		var list = all[name];
		if (!list && create) {
			list = all[name] = [];
		}
		return list || null;
	}

	function MapsEventListener(obj, name, fn, dom) {
		this.obj = obj;
		this.name = name;
		this.fn = fn;
		this.dom = dom || null;
	}

	MapsEventListener.prototype.remove = function () {
		removeListener(this);
	};

	function addListener(obj, name, fn) {
		var handle = new MapsEventListener(obj, name, fn);
		listenerList(obj, name, true).push(handle);
		return handle;
	}

	function addListenerOnce(obj, name, fn) {
		var handle = addListener(obj, name, function () {
			removeListener(handle);
			return fn.apply(this, arguments);
		});
		return handle;
	}

	function removeListener(handle) {
		if (!handle) {
			return;
		}
		if (handle.dom) {
			handle.obj.removeEventListener(handle.name, handle.dom, !!handle.capture);
			handle.dom = null;
			return;
		}
		var list = listenerList(handle.obj, handle.name, false);
		if (list) {
			var i = list.indexOf(handle);
			if (i >= 0) {
				list.splice(i, 1);
			}
		}
	}

	function clearListeners(obj, name) {
		var list = listenerList(obj, name, false);
		if (list) {
			list.length = 0;
		}
	}

	function clearInstanceListeners(obj) {
		if (obj && obj.__gm_listeners__) {
			obj.__gm_listeners__ = {};
		}
	}

	function hasListeners(obj, name) {
		var list = listenerList(obj, name, false);
		return !!(list && list.length);
	}

	function trigger(obj, name) {
		var list = listenerList(obj, name, false);
		if (!list || !list.length) {
			return;
		}
		var args = slice.call(arguments, 2);
		list = list.slice();
		for (var i = 0; i < list.length; i++) {
			list[i].fn.apply(obj, args);
		}
	}

	function addDomListener(el, name, fn, capture) {
		var handle = new MapsEventListener(el, name, fn);
		handle.capture = !!capture;
		handle.dom = function (e) {
			return fn.call(el, e || window.event);
		};
		el.addEventListener(name, handle.dom, !!capture);
		return handle;
	}

	function addDomListenerOnce(el, name, fn, capture) {
		var handle = addDomListener(el, name, function () {
			removeListener(handle);
			return fn.apply(this, arguments);
		}, capture);
		return handle;
	}

	// ------------------------------------------------------------------
	// Basic types
	// ------------------------------------------------------------------

	function LatLng(lat, lng, noWrap) {
		if (lat && typeof lat === 'object') {
			noWrap = lng;
			lng = typeof lat.lng === 'function' ? lat.lng() : lat.lng;
			lat = typeof lat.lat === 'function' ? lat.lat() : lat.lat;
		}
		lat = +lat;
		lng = +lng;
		if (!noWrap) {
			lat = clamp(lat, -90, 90);
			lng = wrapLng(lng);
		}
		hidden(this, '_lat', lat);
		hidden(this, '_lng', lng);
	}

	LatLng.prototype.lat = function () {
		return this._lat;
	};
	LatLng.prototype.lng = function () {
		return this._lng;
	};
	LatLng.prototype.equals = function (other) {
		return !!other && Math.abs(this._lat - other.lat()) < 1e-9 && Math.abs(this._lng - other.lng()) < 1e-9;
	};
	LatLng.prototype.toString = function () {
		return '(' + this._lat + ', ' + this._lng + ')';
	};
	LatLng.prototype.toUrlValue = function (precision) {
		var p = precision === undefined ? 6 : precision;
		return (+this._lat.toFixed(p)) + ',' + (+this._lng.toFixed(p));
	};
	LatLng.prototype.toJSON = function () {
		return { lat: this._lat, lng: this._lng };
	};

	function toLatLng(value) {
		if (!value) {
			return null;
		}
		if (value instanceof LatLng) {
			return value;
		}
		if (typeof value.lat === 'function') {
			return new LatLng(value.lat(), value.lng());
		}
		return new LatLng(value.lat, value.lng !== undefined ? value.lng : value.lon);
	}

	function lngSpan(west, east) {
		var d = east - west;
		return d >= 0 ? d : d + 360;
	}

	function LatLngBounds(sw, ne) {
		hidden(this, '_s', 1);
		hidden(this, '_n', -1);
		hidden(this, '_w', 180);
		hidden(this, '_e', -180);
		hidden(this, '_lngEmpty', true);
		if (sw) {
			sw = toLatLng(sw);
			ne = ne ? toLatLng(ne) : sw;
			this._s = sw.lat();
			this._n = ne.lat();
			var w = sw.lng();
			var e = ne.lng();
			this._lngEmpty = false;
			if (e - w >= 360) {
				this._w = -180;
				this._e = 180;
			} else {
				this._w = wrapLng(w);
				this._e = wrapLng(e);
			}
		}
	}

	LatLngBounds.prototype._lngFull = function () {
		return !this._lngEmpty && this._e - this._w >= 360;
	};

	LatLngBounds.prototype._crosses = function () {
		return !this._lngEmpty && this._w > this._e;
	};

	LatLngBounds.prototype._containsLng = function (lng) {
		if (this._lngEmpty) {
			return false;
		}
		if (this._lngFull()) {
			return true;
		}
		var alt = lng === -180 ? 180 : (lng === 180 ? -180 : lng);
		if (this._crosses()) {
			return lng >= this._w || lng <= this._e || alt >= this._w || alt <= this._e;
		}
		return (lng >= this._w && lng <= this._e) || (alt >= this._w && alt <= this._e);
	};

	LatLngBounds.prototype.isEmpty = function () {
		return this._s > this._n || this._lngEmpty;
	};

	LatLngBounds.prototype.contains = function (latLng) {
		latLng = toLatLng(latLng);
		if (!latLng) {
			return false;
		}
		var lat = latLng.lat();
		return lat >= this._s && lat <= this._n && this._containsLng(latLng.lng());
	};

	LatLngBounds.prototype.extend = function (latLng) {
		latLng = toLatLng(latLng);
		if (!latLng) {
			return this;
		}
		var lat = latLng.lat();
		var lng = latLng.lng();
		if (this._s > this._n) {
			this._s = this._n = lat;
		} else {
			this._s = Math.min(this._s, lat);
			this._n = Math.max(this._n, lat);
		}
		if (this._lngEmpty) {
			this._w = this._e = lng;
			this._lngEmpty = false;
		} else if (!this._containsLng(lng)) {
			if (lngSpan(lng, this._w) < lngSpan(this._e, lng)) {
				this._w = lng;
			} else {
				this._e = lng;
			}
		}
		return this;
	};

	LatLngBounds.prototype.union = function (other) {
		if (other && !other.isEmpty()) {
			this.extend(other.getSouthWest());
			this.extend(other.getNorthEast());
		}
		return this;
	};

	LatLngBounds.prototype.getNorthEast = function () {
		return new LatLng(this._n, this._e, true);
	};

	LatLngBounds.prototype.getSouthWest = function () {
		return new LatLng(this._s, this._w, true);
	};

	LatLngBounds.prototype.getCenter = function () {
		var lat = (this._s + this._n) / 2;
		var lng;
		if (this._lngFull()) {
			lng = 0;
		} else {
			lng = wrapLng(this._w + lngSpan(this._w, this._e) / 2);
		}
		return new LatLng(lat, lng);
	};

	LatLngBounds.prototype.toSpan = function () {
		return new LatLng(this._s > this._n ? 0 : this._n - this._s,
			this._lngEmpty ? 0 : (this._lngFull() ? 360 : lngSpan(this._w, this._e)), true);
	};

	LatLngBounds.prototype.intersects = function (other) {
		if (!other || this.isEmpty() || other.isEmpty()) {
			return false;
		}
		var latOverlap = this._s <= other._n && other._s <= this._n;
		if (!latOverlap) {
			return false;
		}
		return this._containsLng(other._w) || this._containsLng(other._e) ||
			other._containsLng(this._w) || other._containsLng(this._e);
	};

	LatLngBounds.prototype.equals = function (other) {
		return !!other && this.getSouthWest().equals(other.getSouthWest()) && this.getNorthEast().equals(other.getNorthEast());
	};

	LatLngBounds.prototype.toString = function () {
		return '(' + this.getSouthWest() + ', ' + this.getNorthEast() + ')';
	};

	LatLngBounds.prototype.toUrlValue = function (precision) {
		return this.getSouthWest().toUrlValue(precision) + ',' + this.getNorthEast().toUrlValue(precision);
	};

	LatLngBounds.prototype.toJSON = function () {
		return { south: this._s, west: this._w, north: this._n, east: this._e };
	};

	function toLatLngBounds(b) {
		if (!b) {
			return null;
		}
		if (b instanceof LatLngBounds) {
			return b;
		}
		if (b.getSouthWest) {
			return new LatLngBounds(b.getSouthWest(), b.getNorthEast());
		}
		return new LatLngBounds(new LatLng(b.south, b.west), new LatLng(b.north, b.east));
	}

	function Point(x, y) {
		this.x = x;
		this.y = y;
	}
	Point.prototype.equals = function (o) {
		return !!o && o.x === this.x && o.y === this.y;
	};
	Point.prototype.toString = function () {
		return '(' + this.x + ', ' + this.y + ')';
	};

	function Size(width, height, widthUnit, heightUnit) {
		this.width = width;
		this.height = height;
		this.widthUnit = widthUnit;
		this.heightUnit = heightUnit;
	}
	Size.prototype.equals = function (o) {
		return !!o && o.width === this.width && o.height === this.height;
	};
	Size.prototype.toString = function () {
		return '(' + this.width + ', ' + this.height + ')';
	};

	function MarkerImage(url, size, origin, anchor, scaledSize) {
		this.url = url;
		this.size = size || null;
		this.origin = origin || null;
		this.anchor = anchor || null;
		this.scaledSize = scaledSize || null;
	}

	// ------------------------------------------------------------------
	// MVC
	// ------------------------------------------------------------------

	function MVCObject() {}

	MVCObject.prototype.get = function (key) {
		var getter = this['get' + capitalize(key)];
		if (typeof getter === 'function' && getter !== MVCObject.prototype.get) {
			return getter.call(this);
		}
		return this[key];
	};

	MVCObject.prototype.set = function (key, value) {
		var setter = this['set' + capitalize(key)];
		if (typeof setter === 'function' && setter !== MVCObject.prototype.set) {
			setter.call(this, value);
			return;
		}
		this[key] = value;
		this.notify(key);
	};

	MVCObject.prototype.setValues = function (values) {
		if (!values) {
			return;
		}
		for (var key in values) {
			if (Object.prototype.hasOwnProperty.call(values, key)) {
				this.set(key, values[key]);
			}
		}
	};

	MVCObject.prototype.notify = function (key) {
		var handler = this[key + '_changed'];
		if (typeof handler === 'function') {
			handler.call(this);
		}
		trigger(this, key + '_changed');
	};

	MVCObject.prototype.changed = function () {};
	MVCObject.prototype.bindTo = function () {};
	MVCObject.prototype.unbind = function () {};
	MVCObject.prototype.unbindAll = function () {};

	function inherit(Child, Parent) {
		Child.prototype = Object.create(Parent.prototype);
		Child.prototype.constructor = Child;
	}

	function MVCArray(array) {
		hidden(this, '_a', array ? array.slice() : []);
	}
	inherit(MVCArray, MVCObject);
	MVCArray.prototype.getArray = function () {
		return this._a;
	};
	MVCArray.prototype.getLength = function () {
		return this._a.length;
	};
	MVCArray.prototype.getAt = function (i) {
		return this._a[i];
	};
	MVCArray.prototype.setAt = function (i, v) {
		this._a[i] = v;
		trigger(this, 'set_at', i);
	};
	MVCArray.prototype.insertAt = function (i, v) {
		this._a.splice(i, 0, v);
		trigger(this, 'insert_at', i);
	};
	MVCArray.prototype.removeAt = function (i) {
		var v = this._a.splice(i, 1)[0];
		trigger(this, 'remove_at', i, v);
		return v;
	};
	MVCArray.prototype.push = function (v) {
		this.insertAt(this._a.length, v);
		return this._a.length;
	};
	MVCArray.prototype.pop = function () {
		return this.removeAt(this._a.length - 1);
	};
	MVCArray.prototype.clear = function () {
		while (this._a.length) {
			this.pop();
		}
	};
	MVCArray.prototype.forEach = function (fn) {
		for (var i = 0; i < this._a.length; i++) {
			fn(this._a[i], i);
		}
	};

	function toPathArray(path) {
		if (!path) {
			return [];
		}
		if (path instanceof MVCArray) {
			path = path.getArray();
		}
		var result = [];
		for (var i = 0; i < path.length; i++) {
			var ll = toLatLng(path[i]);
			if (ll) {
				result.push(ll);
			}
		}
		return result;
	}

	// ------------------------------------------------------------------
	// Map types
	// ------------------------------------------------------------------

	function MercatorProjection() {}
	MercatorProjection.prototype.fromLatLngToPoint = function (latLng, point) {
		var siny = clamp(Math.sin(latLng.lat() * Math.PI / 180), -0.9999, 0.9999);
		point = point || new Point(0, 0);
		point.x = 128 + latLng.lng() * (256 / 360);
		point.y = 128 + 0.5 * Math.log((1 + siny) / (1 - siny)) * -(256 / (2 * Math.PI));
		return point;
	};
	MercatorProjection.prototype.fromPointToLatLng = function (point, noWrap) {
		var lng = (point.x - 128) / (256 / 360);
		var latRad = (point.y - 128) / -(256 / (2 * Math.PI));
		var lat = (2 * Math.atan(Math.exp(latRad)) - Math.PI / 2) * 180 / Math.PI;
		return new LatLng(lat, lng, noWrap);
	};

	function OsmMapType(name, opts) {
		opts = opts || {};
		this.name = opts.name || name;
		this.alt = opts.alt || this.name;
		this.maxZoom = opts.maxZoom ? Math.min(opts.maxZoom, MAX_ZOOM) : MAX_ZOOM;
		this.minZoom = opts.minZoom || 0;
		this.tileSize = new Size(256, 256);
		this.projection = new MercatorProjection();
		this.radius = 6378137;
	}

	function StyledMapType(styles, opts) {
		OsmMapType.call(this, (opts && opts.name) || 'Styled', opts);
		this.styles = styles;
	}
	StyledMapType.prototype = Object.create(OsmMapType.prototype);

	function ImageMapType(opts) {
		OsmMapType.call(this, (opts && opts.name) || 'Image', opts);
	}
	ImageMapType.prototype = Object.create(OsmMapType.prototype);

	// Supports both mapTypes.get(id) and the direct mapTypes[id] access used by MarkerClusterer.
	function MapTypeRegistry() {}
	inherit(MapTypeRegistry, MVCObject);
	MapTypeRegistry.prototype.get = function (id) {
		return Object.prototype.hasOwnProperty.call(this, id) ? this[id] : undefined;
	};
	MapTypeRegistry.prototype.set = function (id, mapType) {
		this[id] = mapType;
		trigger(this, String(id).toLowerCase() + '_changed');
	};

	// ------------------------------------------------------------------
	// Map
	// ------------------------------------------------------------------

	var injectedCss = false;

	function injectCss() {
		if (injectedCss) {
			return;
		}
		injectedCss = true;
		var css = (window.__osmLeafletCss || '') +
			'.gm-osm-map{position:absolute;left:0;top:0;right:0;bottom:0;z-index:0;overflow:hidden;}' +
			'.gm-osm-map.leaflet-container{font:10px Tahoma,Arial,sans-serif;}' +
			'.gm-osm-map .leaflet-control-attribution{font-size:9px;line-height:12px;padding:0 4px;color:#333;background:rgba(255,255,255,0.65);}' +
			'.gm-osm-map .leaflet-control-scale-line{font-size:9px;line-height:1.2;}' +
			'.gm-osm-map .leaflet-marker-icon{-webkit-user-drag:none;}' +
			'.gm-osm-default-icon{border-radius:50%;background:#e8432e;border:2px solid #fff;box-sizing:border-box;}' +
			'@keyframes gmOsmBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}' +
			'.gm-osm-bounce{animation:gmOsmBounce 0.7s ease-in-out infinite;}';
		var style = document.createElement('style');
		style.type = 'text/css';
		style.appendChild(document.createTextNode(css));
		(document.head || document.getElementsByTagName('head')[0] || document.documentElement).appendChild(style);
	}

	var PANE_DEFS = [
		['overlayLayer', 450],
		['overlayShadow', 500],
		['overlayImage', 610],
		['floatShadow', 640],
		['overlayMouseTarget', 650],
		['floatPane', 700]
	];

	function GMap(div, opts) {
		opts = opts || {};
		injectCss();

		var self = this;
		hidden(this, '__div', div);
		hidden(this, '__overlays', []);
		hidden(this, '__paths', []);
		hidden(this, '__markers', []);
		hidden(this, '__mapTypeId', opts.mapTypeId || MapTypeId.ROADMAP);
		hidden(this, '__lastZoom', null);
		hidden(this, '__lastDragEnd', 0);
		hidden(this, '__tilt', 0);
		hidden(this, '__heading', 0);
		hidden(this, '__streetView', null);

		this.mapTypes = new MapTypeRegistry();
		this.mapTypes.set(MapTypeId.ROADMAP, new OsmMapType('Map'));
		this.mapTypes.set(MapTypeId.SATELLITE, new OsmMapType('Satellite'));
		this.mapTypes.set(MapTypeId.HYBRID, new OsmMapType('Hybrid'));
		this.mapTypes.set(MapTypeId.TERRAIN, new OsmMapType('Terrain'));
		this.controls = [];
		for (var p = 0; p <= 13; p++) {
			this.controls[p] = new MVCArray();
		}

		var computed = window.getComputedStyle ? window.getComputedStyle(div) : null;
		if (!computed || computed.position === 'static') {
			div.style.position = 'relative';
		}
		var inner = document.createElement('div');
		inner.className = 'gm-osm-map';
		if (opts.backgroundColor) {
			inner.style.background = opts.backgroundColor;
		}
		div.appendChild(inner);
		hidden(this, '__inner', inner);

		var center = toLatLng(opts.center) || new LatLng(0, 0);
		var zoom = typeof opts.zoom === 'number' ? opts.zoom : 2;
		var minZoom = typeof opts.minZoom === 'number' ? opts.minZoom : 0;

		var lmap = L.map(inner, {
			center: [center.lat(), center.lng()],
			zoom: Math.max(zoom, minZoom),
			minZoom: minZoom,
			maxZoom: typeof opts.maxZoom === 'number' ? Math.min(opts.maxZoom, MAX_ZOOM) : MAX_ZOOM,
			zoomControl: false,
			attributionControl: false,
			zoomAnimation: false,
			markerZoomAnimation: false,
			fadeAnimation: true,
			boxZoom: false,
			tap: false,
			dragging: opts.draggable !== false,
			scrollWheelZoom: opts.scrollwheel !== false,
			doubleClickZoom: !opts.disableDoubleClickZoom,
			keyboard: opts.keyboardShortcuts !== false,
			maxBounds: L.latLngBounds([-MAX_LAT, -1e6], [MAX_LAT, 1e6]),
			maxBoundsViscosity: 1.0,
			worldCopyJump: false
		});
		hidden(this, '__lmap', lmap);

		L.tileLayer(TILE_URL, {
			maxZoom: MAX_ZOOM,
			maxNativeZoom: MAX_ZOOM,
			keepBuffer: 2,
			updateWhenIdle: false
		}).addTo(lmap);

		L.control.attribution({ prefix: false, position: 'bottomright' })
			.addAttribution(TILE_ATTRIBUTION)
			.addTo(lmap);

		if (opts.scaleControl) {
			L.control.scale({ position: 'bottomleft', metric: true, imperial: true }).addTo(lmap);
		}

		var panes = {};
		for (var i = 0; i < PANE_DEFS.length; i++) {
			var pane = lmap.createPane('gm_' + PANE_DEFS[i][0]);
			pane.style.zIndex = PANE_DEFS[i][1];
			panes[PANE_DEFS[i][0]] = pane;
		}
		panes.mapPane = lmap.getPane('tilePane');
		hidden(this, '__panes', panes);
		this.__installPaneEventGuards(panes);

		hidden(this, '__projection', new MapCanvasProjection(this));

		this.__bindLeafletEvents();
		this.__lastZoom = lmap.getZoom();

		later(function () {
			trigger(self, 'projection_changed');
			trigger(self, 'bounds_changed');
			trigger(self, 'idle');
			trigger(self, 'tilesloaded');
		});
	}
	inherit(GMap, MVCObject);

	GMap.prototype.__installPaneEventGuards = function (panes) {
		var self = this;
		var guard = function (e) {
			// Swallow the click that ends a map drag started on top of an overlay (e.g. a cluster icon).
			if (new Date().getTime() - self.__lastDragEnd < 50) {
				e.stopPropagation();
				e.preventDefault();
			}
		};
		var stop = function (e) {
			// Overlay DOM events (cluster icons) are handled by the overlay itself, not by the map.
			e.stopPropagation();
			if (e.type === 'contextmenu') {
				e.preventDefault();
			}
		};
		var names = ['overlayImage', 'floatShadow', 'overlayMouseTarget', 'floatPane'];
		for (var i = 0; i < names.length; i++) {
			var pane = panes[names[i]];
			pane.addEventListener('click', guard, true);
			pane.addEventListener('click', stop, false);
			pane.addEventListener('dblclick', stop, false);
			pane.addEventListener('contextmenu', stop, false);
		}
	};

	GMap.prototype.__mouseEvent = function (e) {
		var latLng = e.latlng ? new LatLng(e.latlng.lat, e.latlng.lng) : this.getCenter();
		var pixel = e.containerPoint ? new Point(e.containerPoint.x, e.containerPoint.y) : null;
		var dom = e.originalEvent || null;
		return {
			latLng: latLng,
			pixel: pixel,
			domEvent: dom,
			stop: function () {
				if (dom) {
					L.DomEvent.stop(dom);
				}
			}
		};
	};

	GMap.prototype.__bindLeafletEvents = function () {
		var self = this;
		var lmap = this.__lmap;

		var mouse = function (gname) {
			return function (e) {
				// Google Maps does not pass mouse events that hit an overlay on to the map.
				if (e.originalEvent && e.originalEvent.__gmOverlayEvent) {
					return;
				}
				if (hasListeners(self, gname)) {
					trigger(self, gname, self.__mouseEvent(e));
				}
			};
		};
		lmap.on('click', mouse('click'));
		lmap.on('dblclick', mouse('dblclick'));
		lmap.on('mousedown', mouse('mousedown'));
		lmap.on('mouseup', mouse('mouseup'));
		lmap.on('mousemove', mouse('mousemove'));
		lmap.on('mouseover', mouse('mouseover'));
		lmap.on('mouseout', mouse('mouseout'));
		lmap.on('contextmenu', mouse('rightclick'));

		lmap.on('dragstart', function () {
			trigger(self, 'dragstart');
		});
		lmap.on('drag', function () {
			trigger(self, 'drag');
		});
		lmap.on('dragend', function () {
			self.__lastDragEnd = new Date().getTime();
			trigger(self, 'dragend');
		});

		lmap.on('zoom', function () {
			var z = lmap.getZoom();
			self.__redrawOverlays();
			if (z !== self.__lastZoom) {
				self.__lastZoom = z;
				trigger(self, 'zoom_changed');
			}
		});
		lmap.on('move', function () {
			trigger(self, 'center_changed');
			trigger(self, 'bounds_changed');
		});
		lmap.on('viewreset', function () {
			self.__redrawOverlays();
		});
		lmap.on('resize', function () {
			self.__redrawOverlays();
			trigger(self, 'resize');
			trigger(self, 'bounds_changed');
		});
		lmap.on('moveend', function () {
			self.__redrawOverlays();
			self.__updateMarkerWrap();
			trigger(self, 'idle');
		});
		lmap.on('load', function () {
			trigger(self, 'tilesloaded');
		});
	};

	GMap.prototype.__redrawOverlays = function () {
		var list = this.__overlays.slice();
		for (var i = 0; i < list.length; i++) {
			var ov = list[i];
			if (ov.__gm_added__ && typeof ov.draw === 'function') {
				ov.draw();
			}
		}
		var paths = this.__paths.slice();
		for (var j = 0; j < paths.length; j++) {
			if (paths[j].__onViewChanged) {
				paths[j].__onViewChanged();
			}
		}
	};

	GMap.prototype.__updateMarkerWrap = function () {
		var markers = this.__markers.slice();
		for (var i = 0; i < markers.length; i++) {
			markers[i].__rewrap();
		}
	};

	// Shift a longitude to the world copy closest to the current view so overlays
	// show up next to the map center, like Google Maps does.
	GMap.prototype.__nearLng = function (lng, refLng) {
		if (refLng === undefined) {
			refLng = this.__lmap.getCenter().lng;
		}
		while (lng - refLng > 180) {
			lng -= 360;
		}
		while (lng - refLng < -180) {
			lng += 360;
		}
		return lng;
	};

	GMap.prototype.__toL = function (latLng, refLng) {
		latLng = toLatLng(latLng);
		return L.latLng(latLng.lat(), this.__nearLng(latLng.lng(), refLng));
	};

	GMap.prototype.__toLBounds = function (bounds) {
		bounds = toLatLngBounds(bounds);
		var w = bounds._w;
		var e = bounds._e;
		if (bounds._lngFull()) {
			w = -180;
			e = 180;
		} else if (w > e) {
			e += 360;
		}
		var mid = (w + e) / 2;
		var shift = this.__nearLng(mid) - mid;
		return L.latLngBounds([bounds._s, w + shift], [bounds._n, e + shift]);
	};

	GMap.prototype.getDiv = function () {
		return this.__div;
	};

	GMap.prototype.getCenter = function () {
		var c = this.__lmap.getCenter();
		return new LatLng(c.lat, c.lng);
	};

	GMap.prototype.setCenter = function (latLng) {
		latLng = toLatLng(latLng);
		if (!latLng) {
			return;
		}
		this.__lmap.setView(this.__toL(latLng), this.__lmap.getZoom(), { animate: false });
	};

	GMap.prototype.panTo = function (latLng) {
		latLng = toLatLng(latLng);
		if (!latLng) {
			return;
		}
		this.__lmap.panTo(this.__toL(latLng), { animate: true, duration: 0.25 });
	};

	GMap.prototype.panBy = function (x, y) {
		this.__lmap.panBy([x, y], { animate: true, duration: 0.25 });
	};

	GMap.prototype.panToBounds = function (bounds) {
		bounds = toLatLngBounds(bounds);
		if (!bounds || bounds.isEmpty()) {
			return;
		}
		var view = this.getBounds();
		if (view && view.contains(bounds.getSouthWest()) && view.contains(bounds.getNorthEast())) {
			return;
		}
		this.panTo(bounds.getCenter());
	};

	GMap.prototype.fitBounds = function (bounds, padding) {
		bounds = toLatLngBounds(bounds);
		if (!bounds || bounds.isEmpty()) {
			return;
		}
		var pad = typeof padding === 'number' ? padding : 0;
		this.__lmap.fitBounds(this.__toLBounds(bounds), { animate: false, padding: [pad, pad] });
	};

	GMap.prototype.getBounds = function () {
		var lmap = this.__lmap;
		if (!lmap._loaded) {
			return undefined;
		}
		var size = lmap.getSize();
		if (!size.x || !size.y) {
			var c = this.getCenter();
			return new LatLngBounds(c, c);
		}
		var b = lmap.getBounds();
		var s = clamp(b.getSouth(), -90, 90);
		var n = clamp(b.getNorth(), -90, 90);
		var w = b.getWest();
		var e = b.getEast();
		if (e - w >= 360) {
			return new LatLngBounds(new LatLng(s, -180), new LatLng(n, 180, true));
		}
		return new LatLngBounds(new LatLng(s, w), new LatLng(n, e));
	};

	GMap.prototype.getZoom = function () {
		return this.__lmap.getZoom();
	};

	GMap.prototype.setZoom = function (zoom) {
		zoom = Math.round(+zoom);
		if (isNaN(zoom)) {
			return;
		}
		this.__lmap.setZoom(zoom, { animate: false });
	};

	GMap.prototype.getMapTypeId = function () {
		return this.__mapTypeId;
	};

	GMap.prototype.setMapTypeId = function (id) {
		if (id === this.__mapTypeId) {
			return;
		}
		this.__mapTypeId = id;
		var mt = this.mapTypes.get(id);
		if (mt && mt.maxZoom) {
			this.__lmap.setMaxZoom(Math.min(mt.maxZoom, MAX_ZOOM));
		}
		trigger(this, 'maptypeid_changed');
	};

	GMap.prototype.getProjection = function () {
		var mt = this.mapTypes.get(this.__mapTypeId);
		return (mt && mt.projection) || new MercatorProjection();
	};

	GMap.prototype.getTilt = function () {
		return this.__tilt;
	};
	GMap.prototype.setTilt = function (tilt) {
		this.__tilt = tilt || 0;
	};
	GMap.prototype.getHeading = function () {
		return this.__heading;
	};
	GMap.prototype.setHeading = function (heading) {
		this.__heading = heading || 0;
	};

	GMap.prototype.getStreetView = function () {
		if (!this.__streetView) {
			this.__streetView = new StreetViewPanorama();
		}
		return this.__streetView;
	};
	GMap.prototype.setStreetView = function (pano) {
		this.__streetView = pano;
	};

	GMap.prototype.setOptions = function (opts) {
		if (!opts) {
			return;
		}
		var lmap = this.__lmap;
		var toggle = function (handler, on) {
			if (handler) {
				if (on) {
					handler.enable();
				} else {
					handler.disable();
				}
			}
		};
		if ('draggable' in opts) {
			toggle(lmap.dragging, opts.draggable !== false);
		}
		if ('scrollwheel' in opts) {
			toggle(lmap.scrollWheelZoom, opts.scrollwheel !== false);
		}
		if ('disableDoubleClickZoom' in opts) {
			toggle(lmap.doubleClickZoom, !opts.disableDoubleClickZoom);
		}
		if ('keyboardShortcuts' in opts) {
			toggle(lmap.keyboard, opts.keyboardShortcuts !== false);
		}
		if (typeof opts.minZoom === 'number') {
			lmap.setMinZoom(opts.minZoom);
		}
		if (typeof opts.maxZoom === 'number') {
			lmap.setMaxZoom(Math.min(opts.maxZoom, MAX_ZOOM));
		}
		if (opts.backgroundColor) {
			this.__inner.style.background = opts.backgroundColor;
		}
		if (opts.mapTypeId) {
			this.setMapTypeId(opts.mapTypeId);
		}
		if (opts.center) {
			this.setCenter(opts.center);
		}
		if (typeof opts.zoom === 'number') {
			this.setZoom(opts.zoom);
		}
	};

	// ------------------------------------------------------------------
	// Projection used by OverlayView.getProjection()
	// ------------------------------------------------------------------

	function MapCanvasProjection(map) {
		hidden(this, '__map', map);
	}

	MapCanvasProjection.prototype.fromLatLngToDivPixel = function (latLng) {
		if (!latLng) {
			return null;
		}
		var p = this.__map.__lmap.latLngToLayerPoint(this.__map.__toL(latLng));
		return new Point(p.x, p.y);
	};

	MapCanvasProjection.prototype.fromDivPixelToLatLng = function (pixel, noWrap) {
		if (!pixel) {
			return null;
		}
		var ll = this.__map.__lmap.layerPointToLatLng(L.point(pixel.x, pixel.y));
		return new LatLng(ll.lat, ll.lng, noWrap);
	};

	MapCanvasProjection.prototype.fromLatLngToContainerPixel = function (latLng) {
		if (!latLng) {
			return null;
		}
		var p = this.__map.__lmap.latLngToContainerPoint(this.__map.__toL(latLng));
		return new Point(p.x, p.y);
	};

	MapCanvasProjection.prototype.fromContainerPixelToLatLng = function (pixel, noWrap) {
		if (!pixel) {
			return null;
		}
		var ll = this.__map.__lmap.containerPointToLatLng(L.point(pixel.x, pixel.y));
		return new LatLng(ll.lat, ll.lng, noWrap);
	};

	MapCanvasProjection.prototype.getWorldWidth = function () {
		return 256 * Math.pow(2, this.__map.__lmap.getZoom());
	};

	MapCanvasProjection.prototype.getVisibleRegion = function () {
		return { latLngBounds: this.__map.getBounds() };
	};

	// ------------------------------------------------------------------
	// OverlayView
	//
	// MarkerClusterer copies every enumerable property of OverlayView.prototype
	// onto its own classes when they are constructed. Keep this prototype
	// limited to the public Google API (setMap/getMap/getPanes/getProjection)
	// so clusterer methods such as onAdd/draw/remove/show/hide are not replaced.
	// ------------------------------------------------------------------

	var pendingOverlayAdds = [];
	var overlayFlushScheduled = false;

	function flushOverlayAdds() {
		overlayFlushScheduled = false;
		var list = pendingOverlayAdds;
		pendingOverlayAdds = [];
		for (var i = 0; i < list.length; i++) {
			var ov = list[i];
			var map = ov.__gm_map__;
			if (!map || ov.__gm_added__) {
				continue;
			}
			ov.__gm_added__ = true;
			if (typeof ov.onAdd === 'function') {
				ov.onAdd();
			}
			if (ov.__gm_map__ === map && typeof ov.draw === 'function') {
				ov.draw();
			}
		}
	}

	function overlaySetMap(ov, map) {
		var old = ov.__gm_map__ || null;
		map = map || null;
		if (old === map) {
			return;
		}
		if (old) {
			var idx = old.__overlays.indexOf(ov);
			if (idx >= 0) {
				old.__overlays.splice(idx, 1);
			}
		}
		hidden(ov, '__gm_map__', map);
		if (old && ov.__gm_added__) {
			ov.__gm_added__ = false;
			if (typeof ov.onRemove === 'function') {
				ov.onRemove();
			}
		}
		if (map) {
			map.__overlays.push(ov);
			if (!ov.__gm_added__) {
				hidden(ov, '__gm_added__', false);
				pendingOverlayAdds.push(ov);
				if (!overlayFlushScheduled) {
					overlayFlushScheduled = true;
					later(flushOverlayAdds);
				}
			}
		}
		trigger(ov, 'map_changed');
	}

	function OverlayView() {}
	OverlayView.prototype.setMap = function (map) {
		overlaySetMap(this, map);
	};
	OverlayView.prototype.getMap = function () {
		return this.__gm_map__ || null;
	};
	OverlayView.prototype.getPanes = function () {
		var map = this.__gm_map__;
		return map && this.__gm_added__ ? map.__panes : null;
	};
	OverlayView.prototype.getProjection = function () {
		var map = this.__gm_map__;
		return map ? map.__projection : null;
	};

	// ------------------------------------------------------------------
	// Marker
	// ------------------------------------------------------------------

	function iconMetrics(icon) {
		if (!icon) {
			return null;
		}
		if (typeof icon === 'string') {
			return { url: icon };
		}
		var size = icon.scaledSize || icon.size;
		var m = { url: icon.url };
		if (size) {
			m.size = [size.width, size.height];
		}
		if (icon.anchor) {
			m.anchor = [icon.anchor.x, icon.anchor.y];
		} else if (size) {
			m.anchor = [Math.round(size.width / 2), size.height];
		}
		return m;
	}

	function makeLeafletIcon(icon) {
		var m = iconMetrics(icon);
		if (!m || !m.url) {
			return L.divIcon({ className: 'gm-osm-default-icon', iconSize: [14, 14], iconAnchor: [7, 7], html: '' });
		}
		var opts = { iconUrl: m.url, className: 'gm-osm-marker' };
		if (m.size) {
			opts.iconSize = m.size;
		}
		if (m.anchor) {
			opts.iconAnchor = m.anchor;
		}
		return L.icon(opts);
	}

	function Marker(opts) {
		hidden(this, '__lm', null);
		hidden(this, '__map', null);
		hidden(this, '__position', null);
		hidden(this, '__visible', true);
		hidden(this, '__draggable', false);
		hidden(this, '__clickable', true);
		hidden(this, '__icon', null);
		hidden(this, '__title', '');
		hidden(this, '__zIndex', null);
		hidden(this, '__animation', null);
		hidden(this, '__opacity', 1);
		hidden(this, '__initializing', true);
		hidden(this, '__dragging', false);

		// Lightroom toggles dragging by assigning marker.draggable directly.
		Object.defineProperty(this, 'draggable', {
			enumerable: true,
			configurable: true,
			get: function () {
				return this.__draggable;
			},
			set: function (value) {
				this.setDraggable(value);
			}
		});

		this.setValues(opts);
		this.__initializing = false;
		this.__sync();
	}
	inherit(Marker, MVCObject);

	Marker.MAX_ZINDEX = 1000000;

	Marker.prototype.__zOffset = function () {
		return (this.__zIndex || 0) * 10000;
	};

	Marker.prototype.__create = function () {
		var self = this;
		var map = this.__map;
		var interactive = this.__clickable !== false || this.__draggable;
		var lm = L.marker(map.__toL(this.__position), {
			icon: makeLeafletIcon(this.__icon),
			draggable: !!this.__draggable,
			interactive: interactive,
			keyboard: false,
			title: this.__title || '',
			zIndexOffset: this.__zOffset(),
			opacity: this.__opacity,
			riseOnHover: false,
			autoPan: false,
			bubblingMouseEvents: false
		});
		hidden(lm, '__interactive', interactive);

		var mouse = function (gname) {
			return function (e) {
				markOverlayEvent(e);
				if (hasListeners(self, gname)) {
					trigger(self, gname, map.__mouseEvent(e));
				}
			};
		};
		lm.on('click', mouse('click'));
		lm.on('dblclick', mouse('dblclick'));
		lm.on('mousedown', mouse('mousedown'));
		lm.on('mouseup', mouse('mouseup'));
		lm.on('mouseover', mouse('mouseover'));
		lm.on('mouseout', mouse('mouseout'));
		lm.on('contextmenu', mouse('rightclick'));

		var dragEvent = function (latlng) {
			return { latLng: new LatLng(latlng.lat, latlng.lng), stop: function () {} };
		};
		lm.on('dragstart', function () {
			self.__dragging = true;
			trigger(self, 'dragstart', dragEvent(lm.getLatLng()));
		});
		lm.on('drag', function (e) {
			var ll = e.latlng || lm.getLatLng();
			self.__position = new LatLng(ll.lat, ll.lng);
			trigger(self, 'position_changed');
			trigger(self, 'drag', dragEvent(ll));
		});
		lm.on('dragend', function () {
			var ll = lm.getLatLng();
			self.__dragging = false;
			self.__position = new LatLng(ll.lat, ll.lng);
			map.__lastDragEnd = new Date().getTime();
			trigger(self, 'position_changed');
			trigger(self, 'dragend', dragEvent(ll));
		});
		lm.on('add', function () {
			self.__applyAnimation();
		});
		return lm;
	};

	Marker.prototype.__sync = function () {
		if (this.__initializing) {
			return;
		}
		var map = this.__map;
		var show = !!(map && this.__position && this.__visible !== false);
		var lm = this.__lm;
		if (lm && lm.__gmMap !== map) {
			lm.remove();
			this.__lm = lm = null;
		}
		if (!show) {
			if (lm && lm._map) {
				lm.remove();
			}
			return;
		}
		if (!lm) {
			lm = this.__lm = this.__create();
			hidden(lm, '__gmMap', map);
		}
		if (!lm._map) {
			lm.setLatLng(map.__toL(this.__position));
			lm.addTo(map.__lmap);
		}
	};

	Marker.prototype.__rewrap = function () {
		var lm = this.__lm;
		if (lm && lm._map && this.__position && !this.__dragging) {
			var target = this.__map.__toL(this.__position);
			if (Math.abs(target.lng - lm.getLatLng().lng) > 1e-9) {
				lm.setLatLng(target);
			}
		}
	};

	Marker.prototype.setMap = function (map) {
		map = map || null;
		var old = this.__map;
		if (old === map) {
			return;
		}
		if (old) {
			var i = old.__markers.indexOf(this);
			if (i >= 0) {
				old.__markers.splice(i, 1);
			}
		}
		this.__map = map;
		if (map) {
			map.__markers.push(this);
		}
		this.__sync();
		if (!this.__initializing) {
			trigger(this, 'map_changed');
		}
	};
	Marker.prototype.getMap = function () {
		return this.__map;
	};

	Marker.prototype.setPosition = function (latLng) {
		this.__position = toLatLng(latLng);
		if (this.__lm && this.__position && this.__map) {
			this.__lm.setLatLng(this.__map.__toL(this.__position));
		}
		this.__sync();
		if (!this.__initializing) {
			trigger(this, 'position_changed');
		}
	};
	Marker.prototype.getPosition = function () {
		return this.__position;
	};

	Marker.prototype.setVisible = function (visible) {
		this.__visible = visible !== false;
		this.__sync();
		if (!this.__initializing) {
			trigger(this, 'visible_changed');
		}
	};
	Marker.prototype.getVisible = function () {
		return this.__visible;
	};

	Marker.prototype.setDraggable = function (draggable) {
		draggable = !!draggable;
		this.__draggable = draggable;
		var lm = this.__lm;
		if (lm) {
			lm.options.draggable = draggable;
			if (draggable && !lm.__interactive) {
				this.__recreate();
			} else if (lm.dragging && !this.__dragging) {
				if (draggable) {
					lm.dragging.enable();
				} else {
					lm.dragging.disable();
				}
			}
		}
		if (!this.__initializing) {
			trigger(this, 'draggable_changed');
		}
	};
	Marker.prototype.getDraggable = function () {
		return this.__draggable;
	};

	Marker.prototype.setClickable = function (clickable) {
		this.__clickable = clickable !== false;
		var lm = this.__lm;
		if (lm && lm.__interactive !== (this.__clickable || this.__draggable)) {
			this.__recreate();
		}
	};
	Marker.prototype.getClickable = function () {
		return this.__clickable;
	};

	Marker.prototype.__recreate = function () {
		if (this.__lm) {
			this.__lm.remove();
			this.__lm = null;
		}
		this.__sync();
	};

	Marker.prototype.setIcon = function (icon) {
		this.__icon = icon || null;
		var lm = this.__lm;
		if (lm) {
			var licon = makeLeafletIcon(this.__icon);
			var img = lm._icon;
			var m = iconMetrics(this.__icon);
			// Update the existing <img> in place: Leaflet's setIcon() would rebuild the
			// drag handler and abort a drag that is in progress.
			if (img && img.tagName === 'IMG' && m && m.url) {
				lm.options.icon = licon;
				if (img.getAttribute('src') !== m.url) {
					img.src = m.url;
				}
				if (m.size) {
					img.style.width = m.size[0] + 'px';
					img.style.height = m.size[1] + 'px';
				}
				var anchor = m.anchor || (m.size ? [m.size[0] / 2, m.size[1] / 2] : [0, 0]);
				img.style.marginLeft = (-anchor[0]) + 'px';
				img.style.marginTop = (-anchor[1]) + 'px';
			} else if (!this.__dragging) {
				lm.setIcon(licon);
				this.__applyAnimation();
			} else {
				lm.options.icon = licon;
			}
		}
		if (!this.__initializing) {
			trigger(this, 'icon_changed');
		}
	};
	Marker.prototype.getIcon = function () {
		return this.__icon;
	};

	Marker.prototype.setShadow = function (shadow) {
		// Google Maps API 3.14+ no longer renders marker shadows.
		this.shadow = shadow;
	};
	Marker.prototype.getShadow = function () {
		return this.shadow;
	};

	Marker.prototype.setTitle = function (title) {
		this.__title = title || '';
		if (this.__lm && this.__lm._icon) {
			this.__lm._icon.title = this.__title;
		}
	};
	Marker.prototype.getTitle = function () {
		return this.__title;
	};

	Marker.prototype.setZIndex = function (zIndex) {
		this.__zIndex = zIndex;
		if (this.__lm) {
			this.__lm.setZIndexOffset(this.__zOffset());
		}
	};
	Marker.prototype.getZIndex = function () {
		return this.__zIndex;
	};

	Marker.prototype.setOpacity = function (opacity) {
		this.__opacity = typeof opacity === 'number' ? opacity : 1;
		if (this.__lm) {
			this.__lm.setOpacity(this.__opacity);
		}
	};
	Marker.prototype.getOpacity = function () {
		return this.__opacity;
	};

	Marker.prototype.setShape = function (shape) {
		this.shape = shape;
	};
	Marker.prototype.getShape = function () {
		return this.shape;
	};

	Marker.prototype.__applyAnimation = function () {
		var lm = this.__lm;
		if (lm && lm._icon) {
			if (this.__animation === Animation.BOUNCE) {
				L.DomUtil.addClass(lm._icon, 'gm-osm-bounce');
			} else {
				L.DomUtil.removeClass(lm._icon, 'gm-osm-bounce');
			}
		}
	};

	Marker.prototype.setAnimation = function (animation) {
		this.__animation = animation || null;
		this.__applyAnimation();
		if (!this.__initializing) {
			trigger(this, 'animation_changed');
		}
	};
	Marker.prototype.getAnimation = function () {
		return this.__animation;
	};

	// ------------------------------------------------------------------
	// Vector overlays: Polyline, Polygon, Circle, Rectangle
	// ------------------------------------------------------------------

	function PathOverlay() {}
	inherit(PathOverlay, MVCObject);

	PathOverlay.prototype.__initPath = function (opts) {
		hidden(this, '__lp', null);
		hidden(this, '__map', null);
		hidden(this, '__visible', true);
		hidden(this, '__style', {});
		hidden(this, '__zIndex', 0);
		hidden(this, '__clickable', true);
		hidden(this, '__initializing', true);
		this.setValues(opts);
		this.__initializing = false;
		this.__sync();
	};

	PathOverlay.prototype.__styleOptions = function () {
		var s = this.__style;
		var fills = this.__fills();
		var o = {
			color: s.strokeColor || '#000000',
			opacity: s.strokeOpacity === undefined ? 1 : s.strokeOpacity,
			weight: s.strokeWeight === undefined ? 3 : s.strokeWeight,
			fill: fills,
			fillColor: s.fillColor || s.strokeColor || '#000000',
			fillOpacity: s.fillOpacity === undefined ? (fills ? 0.3 : 0) : s.fillOpacity,
			interactive: this.__clickable !== false,
			bubblingMouseEvents: false,
			lineCap: 'round',
			lineJoin: 'round'
		};
		o.stroke = o.weight > 0;
		return o;
	};

	PathOverlay.prototype.__fills = function () {
		return true;
	};

	PathOverlay.prototype.__bindEvents = function (lp) {
		var self = this;
		var map = this.__map;
		var mouse = function (gname) {
			return function (e) {
				markOverlayEvent(e);
				if (hasListeners(self, gname)) {
					trigger(self, gname, map.__mouseEvent(e));
				}
			};
		};
		lp.on('click', mouse('click'));
		lp.on('dblclick', mouse('dblclick'));
		lp.on('mousedown', mouse('mousedown'));
		lp.on('mouseup', mouse('mouseup'));
		lp.on('mousemove', mouse('mousemove'));
		lp.on('mouseover', mouse('mouseover'));
		lp.on('mouseout', mouse('mouseout'));
		lp.on('contextmenu', mouse('rightclick'));
	};

	PathOverlay.prototype.__sync = function () {
		if (this.__initializing) {
			return;
		}
		var map = this.__map;
		var lp = this.__lp;
		if (lp && lp.__gmMap !== map) {
			lp.remove();
			this.__lp = lp = null;
		}
		if (!map || this.__visible === false || !this.__hasGeometry()) {
			if (lp && lp._map) {
				lp.remove();
				this.__removeExtras();
				this.__unregister();
			}
			return;
		}
		if (!lp) {
			lp = this.__lp = this.__createLayer();
			hidden(lp, '__gmMap', map);
			this.__bindEvents(lp);
		} else {
			this.__updateLayer(lp);
		}
		if (!lp._map) {
			lp.addTo(map.__lmap);
			this.__register();
		}
	};

	PathOverlay.prototype.__register = function () {
		var map = this.__map;
		if (map.__paths.indexOf(this) < 0) {
			map.__paths.push(this);
		}
		var sorted = map.__paths.slice().sort(function (a, b) {
			return (a.__zIndex || 0) - (b.__zIndex || 0);
		});
		for (var i = 0; i < sorted.length; i++) {
			if (sorted[i].__lp && sorted[i].__lp._map) {
				sorted[i].__lp.bringToFront();
				if (sorted[i].__arrow && sorted[i].__arrow._map) {
					sorted[i].__arrow.bringToFront();
				}
			}
		}
	};

	PathOverlay.prototype.__unregister = function () {
		var map = this.__lp ? this.__lp.__gmMap : this.__map;
		if (map) {
			var i = map.__paths.indexOf(this);
			if (i >= 0) {
				map.__paths.splice(i, 1);
			}
		}
	};

	PathOverlay.prototype.setMap = function (map) {
		map = map || null;
		if (map === this.__map) {
			return;
		}
		if (this.__lp && this.__lp._map) {
			this.__lp.remove();
			this.__removeExtras();
			this.__unregister();
		}
		this.__map = map;
		this.__sync();
	};
	PathOverlay.prototype.getMap = function () {
		return this.__map;
	};

	PathOverlay.prototype.__removeExtras = function () {};

	PathOverlay.prototype.setVisible = function (visible) {
		this.__visible = visible !== false;
		this.__sync();
	};
	PathOverlay.prototype.getVisible = function () {
		return this.__visible;
	};

	PathOverlay.prototype.setOptions = function (opts) {
		this.setValues(opts);
	};

	PathOverlay.prototype.setZIndex = function (z) {
		this.__zIndex = z || 0;
		if (this.__lp && this.__lp._map) {
			this.__register();
		}
	};
	PathOverlay.prototype.getZIndex = function () {
		return this.__zIndex;
	};

	PathOverlay.prototype.setClickable = function (clickable) {
		this.__clickable = clickable !== false;
		if (this.__lp) {
			if (this.__lp._map) {
				this.__lp.remove();
				this.__removeExtras();
				this.__unregister();
			}
			this.__lp = null;
			this.__sync();
		}
	};
	PathOverlay.prototype.getClickable = function () {
		return this.__clickable;
	};

	PathOverlay.prototype.setDraggable = function (draggable) {
		// Lightroom implements its own dragging for the Navigator rectangle.
		this.draggable = !!draggable;
	};
	PathOverlay.prototype.getDraggable = function () {
		return !!this.draggable;
	};
	PathOverlay.prototype.setEditable = function (editable) {
		this.editable = !!editable;
	};
	PathOverlay.prototype.getEditable = function () {
		return !!this.editable;
	};

	PathOverlay.prototype.__restyle = function () {
		if (this.__lp) {
			this.__lp.setStyle(this.__styleOptions());
		}
	};

	var STYLE_KEYS = ['strokeColor', 'strokeOpacity', 'strokeWeight', 'fillColor', 'fillOpacity'];
	STYLE_KEYS.forEach(function (key) {
		PathOverlay.prototype['set' + capitalize(key)] = function (value) {
			this.__style[key] = value;
			this.__restyle();
		};
		PathOverlay.prototype['get' + capitalize(key)] = function () {
			return this.__style[key];
		};
	});

	PathOverlay.prototype.__unwrapPath = function (path) {
		var result = [];
		var prev = null;
		for (var i = 0; i < path.length; i++) {
			var lng = path[i].lng();
			if (prev !== null) {
				while (lng - prev > 180) {
					lng -= 360;
				}
				while (lng - prev < -180) {
					lng += 360;
				}
			}
			result.push([path[i].lat(), lng]);
			prev = lng;
		}
		if (result.length && this.__map) {
			var shift = this.__map.__nearLng(result[0][1]) - result[0][1];
			if (shift) {
				for (var j = 0; j < result.length; j++) {
					result[j][1] += shift;
				}
			}
		}
		return result;
	};

	// Polyline ----------------------------------------------------------

	function Polyline(opts) {
		hidden(this, '__path', []);
		hidden(this, '__icons', null);
		hidden(this, '__arrow', null);
		this.__initPath(opts);
	}
	inherit(Polyline, PathOverlay);

	Polyline.prototype.__fills = function () {
		return false;
	};
	Polyline.prototype.__hasGeometry = function () {
		return this.__path.length > 0;
	};
	Polyline.prototype.__createLayer = function () {
		var lp = L.polyline(this.__unwrapPath(this.__path), this.__styleOptions());
		var self = this;
		lp.on('add', function () {
			self.__updateArrow();
		});
		return lp;
	};
	Polyline.prototype.__updateLayer = function (lp) {
		lp.setLatLngs(this.__unwrapPath(this.__path));
		lp.setStyle(this.__styleOptions());
		this.__updateArrow();
	};
	Polyline.prototype.__onViewChanged = function () {
		this.__updateArrow();
	};
	Polyline.prototype.__removeExtras = function () {
		if (this.__arrow) {
			this.__arrow.remove();
			this.__arrow = null;
		}
	};
	Polyline.prototype.__restyle = function () {
		PathOverlay.prototype.__restyle.call(this);
		this.__updateArrow();
	};
	Polyline.prototype.__updateArrow = function () {
		var lp = this.__lp;
		var icons = this.__icons;
		var wantsArrow = false;
		if (icons && icons.length) {
			for (var i = 0; i < icons.length; i++) {
				var sym = icons[i] && icons[i].icon;
				if (sym && (sym.path === SymbolPath.FORWARD_CLOSED_ARROW || sym.path === SymbolPath.FORWARD_OPEN_ARROW)) {
					wantsArrow = true;
				}
			}
		}
		if (!wantsArrow || !lp || !lp._map) {
			this.__removeExtras();
			return;
		}
		var latlngs = lp.getLatLngs();
		if (latlngs.length < 2) {
			this.__removeExtras();
			return;
		}
		var lmap = lp._map;
		var tip = lmap.latLngToLayerPoint(latlngs[latlngs.length - 1]);
		var from = lmap.latLngToLayerPoint(latlngs[latlngs.length - 2]);
		var dx = tip.x - from.x;
		var dy = tip.y - from.y;
		var len = Math.sqrt(dx * dx + dy * dy);
		if (len < 1) {
			this.__removeExtras();
			return;
		}
		var weight = this.__style.strokeWeight || 3;
		var headLen = 4 * weight + 2;
		var headHalf = 2 * weight + 1;
		var ux = dx / len;
		var uy = dy / len;
		var base = L.point(tip.x - ux * headLen, tip.y - uy * headLen);
		var left = L.point(base.x - uy * headHalf, base.y + ux * headHalf);
		var right = L.point(base.x + uy * headHalf, base.y - ux * headHalf);
		var pts = [lmap.layerPointToLatLng(tip), lmap.layerPointToLatLng(left), lmap.layerPointToLatLng(right)];
		var color = this.__style.strokeColor || '#000000';
		var opacity = this.__style.strokeOpacity === undefined ? 1 : this.__style.strokeOpacity;
		if (this.__arrow) {
			this.__arrow.setLatLngs(pts);
			this.__arrow.setStyle({ color: color, fillColor: color, opacity: opacity, fillOpacity: opacity });
		} else {
			this.__arrow = L.polygon(pts, {
				color: color,
				weight: 1,
				opacity: opacity,
				fill: true,
				fillColor: color,
				fillOpacity: opacity,
				interactive: false
			}).addTo(lmap);
		}
	};
	Polyline.prototype.setPath = function (path) {
		this.__path = toPathArray(path);
		this.__sync();
	};
	Polyline.prototype.getPath = function () {
		return new MVCArray(this.__path);
	};
	Polyline.prototype.setIcons = function (icons) {
		this.__icons = icons || null;
		this.__updateArrow();
	};
	Polyline.prototype.getIcons = function () {
		return this.__icons;
	};
	Polyline.prototype.setGeodesic = function (geodesic) {
		this.geodesic = !!geodesic;
	};

	// Polygon -----------------------------------------------------------

	function Polygon(opts) {
		hidden(this, '__rings_', []);
		this.__initPath(opts);
	}
	inherit(Polygon, PathOverlay);

	Polygon.prototype.__hasGeometry = function () {
		return this.__rings_.length > 0 && this.__rings_[0].length > 0;
	};
	Polygon.prototype.__rings = function () {
		var rings = [];
		for (var i = 0; i < this.__rings_.length; i++) {
			rings.push(this.__unwrapPath(this.__rings_[i]));
		}
		return rings;
	};
	Polygon.prototype.__createLayer = function () {
		return L.polygon(this.__rings(), this.__styleOptions());
	};
	Polygon.prototype.__updateLayer = function (lp) {
		lp.setLatLngs(this.__rings());
		lp.setStyle(this.__styleOptions());
	};
	Polygon.prototype.setPaths = function (paths) {
		if (paths instanceof MVCArray) {
			paths = paths.getArray();
		}
		paths = paths || [];
		if (paths.length && !(paths[0] instanceof Array) && !(paths[0] instanceof MVCArray)) {
			paths = [paths];
		}
		this.__rings_ = paths.map(toPathArray);
		this.__sync();
	};
	Polygon.prototype.setPath = function (path) {
		this.setPaths([path]);
	};
	Polygon.prototype.getPath = function () {
		return new MVCArray(this.__rings_[0] || []);
	};
	Polygon.prototype.getPaths = function () {
		return new MVCArray(this.__rings_.map(function (p) {
			return new MVCArray(p);
		}));
	};
	Polygon.prototype.setGeodesic = function (geodesic) {
		this.geodesic = !!geodesic;
	};

	// Circle ------------------------------------------------------------

	function Circle(opts) {
		hidden(this, '__center', null);
		hidden(this, '__radius', 0);
		this.__initPath(opts);
	}
	inherit(Circle, PathOverlay);

	Circle.prototype.__hasGeometry = function () {
		return !!this.__center;
	};
	Circle.prototype.__createLayer = function () {
		var o = this.__styleOptions();
		o.radius = this.__radius || 0;
		return L.circle(this.__map.__toL(this.__center), o);
	};
	Circle.prototype.__updateLayer = function (lp) {
		lp.setLatLng(this.__map.__toL(this.__center));
		lp.setRadius(this.__radius || 0);
		lp.setStyle(this.__styleOptions());
	};
	Circle.prototype.__onViewChanged = function () {
		var lp = this.__lp;
		if (lp && lp._map && this.__center) {
			var target = this.__map.__toL(this.__center);
			if (Math.abs(target.lng - lp.getLatLng().lng) > 1e-9) {
				lp.setLatLng(target);
			}
		}
	};
	Circle.prototype.setCenter = function (center) {
		this.__center = toLatLng(center);
		if (this.__lp && this.__map && this.__center) {
			this.__lp.setLatLng(this.__map.__toL(this.__center));
		}
		this.__sync();
		if (!this.__initializing) {
			trigger(this, 'center_changed');
		}
	};
	Circle.prototype.getCenter = function () {
		return this.__center;
	};
	Circle.prototype.setRadius = function (radius) {
		this.__radius = +radius || 0;
		if (this.__lp) {
			this.__lp.setRadius(this.__radius);
		}
		if (!this.__initializing) {
			trigger(this, 'radius_changed');
		}
	};
	Circle.prototype.getRadius = function () {
		return this.__radius;
	};
	Circle.prototype.getBounds = function () {
		if (!this.__center) {
			return null;
		}
		var latDelta = (this.__radius / 6378137) * 180 / Math.PI;
		var cosLat = Math.cos(this.__center.lat() * Math.PI / 180);
		var lngDelta = cosLat > 1e-9 ? latDelta / cosLat : 180;
		return new LatLngBounds(
			new LatLng(this.__center.lat() - latDelta, this.__center.lng() - lngDelta),
			new LatLng(this.__center.lat() + latDelta, this.__center.lng() + lngDelta));
	};
	Circle.prototype.setGeodesic = function (geodesic) {
		this.geodesic = !!geodesic;
	};

	// Rectangle ---------------------------------------------------------

	function Rectangle(opts) {
		hidden(this, '__bounds', null);
		this.__initPath(opts);
	}
	inherit(Rectangle, PathOverlay);

	Rectangle.prototype.__hasGeometry = function () {
		return !!this.__bounds && !this.__bounds.isEmpty();
	};
	Rectangle.prototype.__createLayer = function () {
		return L.rectangle(this.__map.__toLBounds(this.__bounds), this.__styleOptions());
	};
	Rectangle.prototype.__updateLayer = function (lp) {
		lp.setBounds(this.__map.__toLBounds(this.__bounds));
		lp.setStyle(this.__styleOptions());
	};
	Rectangle.prototype.setBounds = function (bounds) {
		bounds = toLatLngBounds(bounds);
		this.__bounds = bounds ? new LatLngBounds(bounds.getSouthWest(), bounds.getNorthEast()) : null;
		this.__sync();
		if (!this.__initializing) {
			trigger(this, 'bounds_changed');
		}
	};
	Rectangle.prototype.getBounds = function () {
		return this.__bounds ? new LatLngBounds(this.__bounds.getSouthWest(), this.__bounds.getNorthEast()) : null;
	};

	// ------------------------------------------------------------------
	// Services that are not available with OpenStreetMap
	// ------------------------------------------------------------------

	function Geocoder() {}
	Geocoder.prototype.geocode = function (request, callback) {
		later(function () {
			if (typeof callback === 'function') {
				callback([], GeocoderStatus.ZERO_RESULTS);
			}
		});
	};

	function StreetViewPanorama() {
		hidden(this, '__position', null);
	}
	inherit(StreetViewPanorama, MVCObject);
	StreetViewPanorama.prototype.setVisible = function () {};
	StreetViewPanorama.prototype.getVisible = function () {
		return false;
	};
	StreetViewPanorama.prototype.setPosition = function (pos) {
		this.__position = pos;
	};
	StreetViewPanorama.prototype.getPosition = function () {
		return this.__position;
	};
	StreetViewPanorama.prototype.setPov = function () {};
	StreetViewPanorama.prototype.getPov = function () {
		return { heading: 0, pitch: 0, zoom: 1 };
	};

	// ------------------------------------------------------------------
	// Constants
	// ------------------------------------------------------------------

	var MapTypeId = {
		ROADMAP: 'roadmap',
		SATELLITE: 'satellite',
		HYBRID: 'hybrid',
		TERRAIN: 'terrain'
	};

	var ControlPosition = {
		TOP_LEFT: 1,
		TOP_CENTER: 2,
		TOP: 2,
		TOP_RIGHT: 3,
		LEFT_CENTER: 4,
		LEFT_TOP: 5,
		LEFT: 5,
		LEFT_BOTTOM: 6,
		RIGHT_TOP: 7,
		RIGHT: 7,
		RIGHT_CENTER: 8,
		RIGHT_BOTTOM: 9,
		BOTTOM_LEFT: 10,
		BOTTOM_CENTER: 11,
		BOTTOM: 11,
		BOTTOM_RIGHT: 12,
		CENTER: 13
	};

	var Animation = { BOUNCE: 1, DROP: 2 };

	var SymbolPath = {
		CIRCLE: 0,
		FORWARD_CLOSED_ARROW: 1,
		FORWARD_OPEN_ARROW: 2,
		BACKWARD_CLOSED_ARROW: 3,
		BACKWARD_OPEN_ARROW: 4
	};

	var GeocoderStatus = {
		OK: 'OK',
		ZERO_RESULTS: 'ZERO_RESULTS',
		OVER_QUERY_LIMIT: 'OVER_QUERY_LIMIT',
		REQUEST_DENIED: 'REQUEST_DENIED',
		INVALID_REQUEST: 'INVALID_REQUEST',
		UNKNOWN_ERROR: 'UNKNOWN_ERROR',
		ERROR: 'ERROR'
	};

	var ElevationStatus = {
		OK: 'OK',
		UNKNOWN_ERROR: 'UNKNOWN_ERROR',
		REQUEST_DENIED: 'REQUEST_DENIED'
	};

	var MaxZoomStatus = { OK: 'OK', ERROR: 'ERROR' };

	var MapTypeControlStyle = { DEFAULT: 0, HORIZONTAL_BAR: 1, DROPDOWN_MENU: 2 };

	// ------------------------------------------------------------------
	// Exports. MaxZoomService and ElevationService are intentionally absent:
	// Lightroom checks for them and skips those features when missing.
	// ------------------------------------------------------------------

	var maps = {
		version: '3.51-osm-leaflet-shim',
		visualRefresh: true,
		Animation: Animation,
		Circle: Circle,
		ControlPosition: ControlPosition,
		ElevationStatus: ElevationStatus,
		Geocoder: Geocoder,
		GeocoderStatus: GeocoderStatus,
		ImageMapType: ImageMapType,
		LatLng: LatLng,
		LatLngBounds: LatLngBounds,
		Map: GMap,
		MapTypeControlStyle: MapTypeControlStyle,
		MapTypeId: MapTypeId,
		Marker: Marker,
		MarkerImage: MarkerImage,
		MaxZoomStatus: MaxZoomStatus,
		MVCArray: MVCArray,
		MVCObject: MVCObject,
		OverlayView: OverlayView,
		Point: Point,
		Polygon: Polygon,
		Polyline: Polyline,
		Rectangle: Rectangle,
		Size: Size,
		StreetViewPanorama: StreetViewPanorama,
		StyledMapType: StyledMapType,
		SymbolPath: SymbolPath,
		event: {
			addListener: addListener,
			addListenerOnce: addListenerOnce,
			addDomListener: addDomListener,
			addDomListenerOnce: addDomListenerOnce,
			removeListener: removeListener,
			clearListeners: clearListeners,
			clearInstanceListeners: clearInstanceListeners,
			trigger: trigger
		}
	};

	window.google = window.google || {};
	window.google.maps = maps;

	// ------------------------------------------------------------------
	// Lightroom's map page injects a <script> tag for the Google Maps loader
	// (callback=initialize). Swallow it and invoke the callback locally.
	// ------------------------------------------------------------------

	function decodeSrc(src) {
		var s = String(src || '');
		for (var i = 0; i < 3; i++) {
			try {
				var d = decodeURIComponent(s);
				if (d === s) {
					break;
				}
				s = d;
			} catch (e) {
				break;
			}
		}
		return s;
	}

	function loaderCallback(node) {
		if (!node || node.nodeType !== 1 || String(node.tagName).toUpperCase() !== 'SCRIPT') {
			return null;
		}
		var src = decodeSrc(node.getAttribute('src') || node.src);
		if (src.indexOf('osm-shim') < 0 && !/maps\/api\/js/i.test(src)) {
			return null;
		}
		var m = /[?&]callback=([A-Za-z_$][\w$]*)/.exec(src);
		return m ? m[1] : '';
	}

	function runLoaderCallback(name) {
		later(function () {
			var fn = name ? window[name] : null;
			if (typeof fn === 'function') {
				fn();
			}
		});
	}

	var nativeAppendChild = Node.prototype.appendChild;
	var nativeInsertBefore = Node.prototype.insertBefore;

	Node.prototype.appendChild = function (child) {
		var cb = loaderCallback(child);
		if (cb !== null) {
			runLoaderCallback(cb);
			return child;
		}
		return nativeAppendChild.call(this, child);
	};

	Node.prototype.insertBefore = function (child, ref) {
		var cb = loaderCallback(child);
		if (cb !== null) {
			runLoaderCallback(cb);
			return child;
		}
		return nativeInsertBefore.call(this, child, ref);
	};
})(window, document, window.L);
