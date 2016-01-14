"use strict";

Array.prototype.forEachCallback = function(callback, finishCallback) {
	var current = 0;
	var self = this;

	function next() {
		if (!self) {
			console.log("Something went wrong...");
			throw('No self!');
			return;
		}
		if (current >= self.length) {
			if (finishCallback) {
				var cb = finishCallback.bind(self);
				cb();
			}
			return;
		}

		var currentItem = self[current++];
		
		var cb = callback.bind(currentItem);
		cb(currentItem, next);
	}

	next();
};

(function(exports) {
	var path = require('path'),
		fs = require('fs'),
		tiptoe = require('tiptoe'),
		http = require('http');

	var _allsets = null;
	var MTGJSON_VERSION_URL = 'https://mtgjson.com/json/version.json';

	// Constants
	var C = {};

	C.SETS_NOT_ON_GATHERER = [ 'ATH', 'ITP', 'DKM', 'RQS', 'DPA' ];
	C.STANDARD_SETS = [ 'KTK', 'FRF', 'DTK', 'ORI', 'BFZ' ];

	// Check if JSON path exists
	fs.stat(path.join(__dirname, 'json'), function(err, stats) { if (err) fs.mkdir(path.join(__dirname, 'json')); });

	function isStandardSet(set) {
		if (C.STANDARD_SETS.indexOf(set.code) >= 0)
			return(true);

		return(false);
	}

	/** Return server version */
	function serverVersion(callback) {
		var req = http.request(
			{
				method: 'GET',
				hostname: 'mtgjson.com',
				port: 80,
				path: '/json/version.json'
			}, 
			function (res) {
				res.on(
					'data',
					function(chunk) {
				 		callback(null, chunk.toString());
				 	}
				 );
			}
		);

		req.on('error', function(e) { callback(e); });

		req.end();
	}

	/** Return local version */
	function currentVersion(callback) {
		var jsonPath = path.join(__dirname, 'json', 'version.json');
		fs.stat(jsonPath, function(err, stats) {
			if (err)
				return(setImmediate(function() { callback(null, ''); }));

			fs.readFile(jsonPath, 'utf8', callback);
		});
	}

	function grabServerContents(callback) {
		var allFilesPath = path.join(__dirname, 'json', 'AllSets-x.json');
		var file = fs.createWriteStream(path.join(__dirname, 'json', 'allsets.tmp'));
		var req = http.request(
			{
				method: 'GET',
				hostname: 'mtgjson.com',
				port: 80,
				path: '/json/AllSets-x.json'
			},
			function (res) {
				res.pipe(file);
				file.on('finish', function(err) {
					if (err)
						return(setImmediate(function() { callback(err); }));

					tiptoe(
						function() {
							var self = this;
							fs.unlink(
								allFilesPath,
								function(err) {
									// We don't care about errors. We just want the unlink to perform if the old file is there.
									self();
								}
							);
						},
						function() {
							fs.rename(path.join(__dirname, 'json', 'allsets.tmp'), allFilesPath, this);
						},
						// Update version info
						function() {
							serverVersion(this);
						},
						function(newCurrentVersion) {
							fs.writeFile(path.join(__dirname, 'json', 'version.json'), newCurrentVersion, 'utf8', this);
						},
						// Al done.
						function(err) {
							if (err)
								callback(err);

							exports.allsets(callback);
						}
					);
				});
			}
		);

		req.on('error', function(e) { callback(e); });
		req.end();
	}

	function isValidSet(set) {
		if (set.isMCISet)
			return(false);

		if (C.SETS_NOT_ON_GATHERER.indexOf(set.code) >= 0)
			return(false);

		return(true);
	}

	function allsets(callback) {
		if (_allsets != null) {
			return(setImmediate(function() { callback(null, _allsets); }));
		}

		var ret = [];
		fs.readFile(path.join(__dirname, 'json', 'AllSets-x.json'), 'utf8', function(err, data) {
			if (err)
				callback(err);

			_allsets = JSON.parse(data);
			callback(null, _allsets);
		});
	}

	function search(parameters, callback) {
		var setValidationFunction = isValidSet;
		var validSets = [];
		var p = [];

		// Check if the given set is in "validSets" array.
		function _setInList(set) {
			var ret = false;
			if (validSets.indexOf(set.code) >= 0)
				ret = true;

			return(ret);
		}

		var fixParameters = function(params) {
			var ret = {};
			if (typeof(params) === 'string') {
				// We only have the card name.
				ret.name = params.toLowerCase();
			}
			else if (typeof(params) === 'object') {
				// We may have more complex data. Let's parse it...
				var keys = Object.keys(params);
				var i;

				for (i = 0; i < keys.length; i++) {
					// Handle special keys...
					if (keys[i] === 'set') {
						var x = params[keys[i]];
						if (typeof(x) === 'function')
							setValidationFunction = x;
						else if (typeof(x) === 'object') {
							if (Array.isArray(x)) {
								setValidationFunction = _setInList;
								validSets = x.map(function(k) { return(k.toUpperCase()); });
							}
							else {
								console.log('ERROR: Dont know what to do with this set parameter: ' + JSON.stringify(x));
							}
						}
						else if (typeof(x) === 'string') {
							validSets = [ x.toUpperCase() ];
							setValidationFunction = _setInList;
						}
						else {
							console.log('ERROR: Dont know what to do with this set parameter: ' + JSON.stringify(x));
						}
					}
					// All other keys goes to the search parameter.
					else {
						ret[keys[i]] = params[keys[i]];
						if (typeof p[keys[i]] === 'string')
							ret[keys[i]] = ret[keys[i]].toLowerCase();
					}
				}
			}
			else {
				// We need either a string or a object. We don't know how to deal with this.
				return(false);
			}

			return(ret);
		}

		var isMatch = function(card, p) {
			// Check if the given card is a match to the current parameters.
			var keys = Object.keys(p);
			var i;

			for (i = 0; i < keys.length; i++) {
				var cKey = keys[i];
				var cValue = card[cKey];


				if (cValue) {
					if (typeof(cValue) === 'number') {
						if (card[cKey] === p[cKey])
							return(true);
						return(false);
					}
					else if (typeof(cValue) === 'string') {
						var re = new RegExp(p[cKey], 'gi');
						if (cValue.match(re))
							return(true);
					}
					else {
						console.error('invalid type of value:' + typeof(cValue));
					}
				}
			}

			return(false);
		}

		var findCard = function(allsets, criteria) {
			var setKeys = Object.keys(allsets);
			var ret = [];
			var i, j;

			//console.log('looking for: ' + JSON.stringify(criteria));

			// We go on each set...
			for (i = 0; i < setKeys.length; i++) {
				var currentSet = allsets[setKeys[i]];

				// Continue only if the current set is valid.
				if (setValidationFunction(currentSet)) {

					// ...and each card...
					for (j = 0; j < currentSet.cards.length; j++) {
						var currentCard = currentSet.cards[j];

						// Check criteria
						if (isMatch(currentCard, criteria)) {
							currentCard.set = currentSet.code;
							ret.push(currentCard);
						}
					}
				}
			}

			return(ret);
		}

		function executeSearch(err, allsets) {
			if (err) {
				console.log("Error fetching all cards!");
				console.log(err);
				throw(err);
			}
			var i;
			var ret = [];
			var setKeys = Object.keys(allsets);

			// In case there is only one parameter...
			if (p.length === 1) {
				return(setImmediate(function() {
					callback(null, findCard(allsets, p[0]));
				}));
			}

			for (i = 0; i < p.length; i++) {
				var obj = {};
				obj.query = p[i];
				obj.results = findCard(allsets, p[i]);

				ret.push(obj);
			}

			callback(null, ret);
		}

		// Make sure parameters is an array
		if (Array.isArray(parameters) === false) {
			parameters = [ parameters ];
		}

		// Fix every parameter
		for (var i = 0; i < parameters.length; i++) {
			p.push(fixParameters(parameters[i]));
		}

		console.log("Searching for: '" + JSON.stringify(p) + "'.");
		allsets(executeSearch);
	}

	exports.allsets = allsets;
	exports.search = search;
	exports.grabServerContents = grabServerContents;
	exports.currentVersion = currentVersion;
	exports.serverVersion = serverVersion;
})(typeof exports === "undefined" ? window.mtgdb = {} : exports);
