/**
 * replacement Scratchpad editor
 * options script
 *
 * TODO:
 *   Make <all_urls> optional; content.js still has it ?
 *   Add more recent permissions; use runtime.getBrowserInfo() to filter ?
 *     (warning on load if older FF, though)
 *   Detect indentation = detect indentation on file load
 *     and ignore indentWithTabs and tabSize prefs ?
 */
(function () {
	'use strict';
/*
	tdList = {
		permission01: HTMLTableCellElement, // td for permission 1
		...
		permission20: HTMLTableCellElement  // td for permission 20
	}
*/
	var
		tdList = {}, // permissions
		dom = {},    // persistent DOM references
		opt;         // (mostly) CodeMirror options from DOM inputs

	// nothing
	function nil() {}

	// changes to stored options
	function onChange( e ) {
		if ( e.target === dom.checkAutoClose ) {
			opt.autoCloseBrackets = dom.checkAutoClose.checked;
		} else if ( e.target === dom.checkUseSpaces ) {
			opt.indentWithTabs = !dom.checkUseSpaces.checked;
		} else if ( e.target === dom.selectFontSize ) {
			opt.fontSize = parseInt( dom.selectFontSize.value, 10 );
		} else if ( e.target === dom.selectTabSize ) {
			opt.tabSize = parseInt( dom.selectTabSize.value, 10 );
		} else if ( e.target === dom.selectKeyMap ) {
			opt.keyMap = dom.selectKeyMap.value;
		}
		browser.storage.local.set( opt );
	}

	// click or keydown on permission table
	function onTable( e ) {
		var
			td = e.target;

		// verify that td is indeed a td
		if (( e.type === 'click' || e.key === ' ' ) && td.tagName === 'TD' ) {
			switch ( td.className ) {
				case '':
					td.className = 'off2on';
					break;
				case 'off2on':
					td.className = '';
					break;
				case 'on':
					td.className = 'on2off';
					break;
				case 'on2off':
					td.className = 'on';
					break;
				default: // ro is the only thing left
			}
		}
	}

	// click on Commit button
	function onCommit() {
		var
			add = [], // permissions to add
			rem = [], // permissions to remove
			keys, i;

		keys = Object.keys( tdList );
		for ( i = 0; i < keys.length; ++i ) {
			switch ( tdList[ keys[ i ] ].className ) {
				case 'off2on':
					add.push( keys[ i ] );
					break;
				case 'on2off':
					rem.push( keys[ i ] );
					break;
				default:
			}
		}

		if ( add.length ) {
			browser.permissions.request( { permissions: add } ).then( nil );
		}
		if ( rem.length ) {
			browser.permissions.remove( { permissions: rem } ).then( nil );
		}
	}

	// permissions have been added
	function onAdded( p ) {
		var
			i;

		p = p.permissions;
		for ( i = 0; i < p.length; ++i ) {
			if ( tdList.hasOwnProperty( p[ i ] ) ) {
				tdList[ p[ i ] ].className = 'on';
			}
		}
	}
	// permissions have been removed
	function onRemoved( p ) {
		var
			i;

		p = p.permissions;
		for ( i = 0; i < p.length; ++i ) {
			if ( tdList.hasOwnProperty( p[ i ] ) ) {
				tdList[ p[ i ] ].className = '';
			}
		}
	}
	// watch permissions in a timeout loop to fake events
	function shim() {
		var
			o; // original permissions

		// get current permissions, compare them to previous permissions
		function loop() {
			browser.permissions.getAll().then( function ( p ) {
				var
					add = [], // added permissions
					rem = [], // removed permissions
					i = 0,
					j = 0;

				p = p.permissions.sort();
				while ( i < p.length && j < o.length ) {
					if ( p[ i ] === o[ j ] ) {
						++i;
						++j;
					} else if ( p[ i ] < o[ j ] ) {
						add.push( p[ i++ ] );
					} else {
						rem.push( o[ j++ ] );
					}
				}
				while ( i < p.length ) {
					add.push( p[ i++ ] );
				}
				while ( j < o.length ) {
					rem.push( o[ j++ ] );
				}
				o = p; // current permissions become original for next iteration
				if ( add.length ) {
					setTimeout( onAdded, 1, { permissions: add } );
				}
				if ( rem.length ) {
					setTimeout( onRemoved, 1, { permissions: rem } );
				}
				setTimeout( loop, 10 );
			} );
		}

		browser.permissions.getAll().then( function ( p ) {
			o = p.permissions.sort();
			setTimeout( loop, 10 );
		} );
	}

	function onContentLoaded() {
		var
			tbody = document.getElementById( 'tbody' ),
			e, i;

		// initialize persistent DOM references
		dom.checkAutoClose = document.getElementById( 'checkAutoClose' );
		dom.checkUseSpaces = document.getElementById( 'checkUseSpaces' );
		dom.selectFontSize = document.getElementById( 'selectFontSize' );
		dom.selectKeyMap = document.getElementById( 'selectKeyMap' );
		dom.selectTabSize = document.getElementById( 'selectTabSize' );
		dom.textShortcut = document.getElementById( 'textShortcut' );

		// get the command keys and display them
		browser.commands.getAll().then( function ( a ) {
			if ( a.length && a[0].shortcut !== '' ) {
				dom.textShortcut.value = a[0].shortcut;
			} else {
				dom.textShortcut.value = '(none)';
			}
		} );

		// get td HTMLElements to set tdList
		// get active permissions
		// set td classes based on active permissions
		e = tbody.getElementsByTagName( 'td' );
		for ( i = 0; i < e.length; ++i ) { // should be 20 of them
			tdList[ e[ i ].textContent ] = e[ i ];
		}
		browser.permissions.getAll().then( function ( p ) {
			var
				i;

			p = p.permissions; // don't care about host permissions
			for ( i = 0; i < p.length; ++i ) {
				if (
					tdList.hasOwnProperty( p[ i ] ) &&
					tdList[ p[ i ] ].className !== 'ro' // readonly (ro) is always on
				) {
					tdList[ p[ i ] ].className = 'on';
				}
			}
		} );

		// onAdded and onRemoved don't exist before FF 77
		if (
			browser.permissions.onAdded === Object( browser.permissions.onAdded ) &&
			browser.permissions.onRemoved === Object( browser.permissions.onRemoved )
		) {
			browser.permissions.onAdded.addListener( onAdded );
			browser.permissions.onRemoved.addListener( onRemoved );
		} else {
			setTimeout( shim ); // shim depends on the DOM
		}

		// click on table cells to select permissiion changes
		// then click Commit to request them
		tbody.addEventListener( 'click', onTable );
		tbody.addEventListener( 'keydown', onTable );
		document.getElementById( 'button' ).addEventListener( 'click', onCommit );

		// get the options from storage
		// background.js should have initialized them
		browser.storage.local.get().then( function ( o ) {
			// save options for later
			opt = o;
			// initialize the dialog
			// option dialog refers to spaces, but CodeMirror refers to tabs
			// because history
			dom.checkAutoClose.checked = o.autoCloseBrackets;
			dom.checkUseSpaces.checked = !o.indentWithTabs;
			dom.selectFontSize.value = o.fontSize.toString();
			dom.selectTabSize.value = o.tabSize.toString();
			dom.selectKeyMap.value = o.keyMap;
			// set the listeners after initializing the dialog
			dom.checkAutoClose.addEventListener( 'change', onChange );
			dom.checkUseSpaces.addEventListener( 'change', onChange );
			dom.selectFontSize.addEventListener( 'change', onChange );
			dom.selectTabSize.addEventListener( 'change', onChange );
			dom.selectKeyMap.addEventListener( 'change', onChange );
		} );
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', onContentLoaded, { once: true } );
	} else {
		onContentLoaded();
	}
}());