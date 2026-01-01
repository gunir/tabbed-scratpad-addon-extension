/**
 * replacement Scratchpad editor
 * background script
 *
 * TODO:
 *   Use extension.getViews() for restarts ?
 */
(function () {
	'use strict';

	var
		port = {},     // conection ports indexed by tabID
		winList = [],  // "normal" content windows, sorted by precedence
		saveList = {}, // "downloads" (saves) in progress
		opt = {        // options (default values)
			autoCloseBrackets: true,
			indentWithTabs: true,
			fontSize: 13,
			tabSize: 2,
			keyMap: 'default'
		},
		optValues = {  // for input validation
			autoCloseBrackets: [ true, false ],
			indentWithTabs: [ true, false ],
			fontSize: [ 10, 11, 12, 13, 14, 16, 18, 20 ],
			tabSize: [ 2, 4, 8 ],
			keyMap: [ 'default', 'vim', 'emacs', 'sublime' ]
		};

	// nothing
	function nil() {}

	// grab the filename specified in the file picker (without path)
	// and url included from downloadItem
	// beware: onCreated triggers for every download, not just Scratchpad's
	// onCreated -> download.then -> onChanged
	function onDownloadCreated( item ) {
		if ( item.byExtensionId === browser.runtime.id ) { // it's Scratchpad's
			saveList[ item.id ] = saveList[ item.id ] || {};
			saveList[ item.id ].filename = item.filename
				.replace( /\\/g, '/' ).replace( /.*\//, '' );  // maybe Windows
			saveList[ item.id ].url = item.url;
		}
	}
	browser.downloads.onCreated.addListener( onDownloadCreated );

	// monitor progress of downloads
	// beware: onChanged triggers for every download, not just Scratchpad's
	// onCreated -> download.then -> onChanged
	function onDownloadChanged( item ) {
		if (
			saveList.hasOwnProperty( item.id ) && // Scratchpad's download
			item.state.current !== 'in_progress'  // 'interrupted' or 'complete'
		) {
			if ( saveList[ item.id ].hasOwnProperty( 'id' ) ) {
				if ( item.state.current === 'complete' ) {
					// success, reply with filename and url
					port[ saveList[ item.id ].id ].postMessage( {
						action: 'download',
						filename: saveList[ item.id ].filename,
						url: saveList[ item.id ].url
					} );
				} else {
					// failure, reply with just url
					port[ saveList[ item.id ].id ].postMessage( {
						action: 'download',
						url: saveList[ item.id ].url
					} );
				}
			} else {
				console.error( 'downloads.onChanged: missing tab ID for post' );
			}
			if ( item.error ) {
				// probably a file/directory permission issue
				console.error( 'downloads.onChanged: ' + item.error );
			}
			// clean up
			browser.downloads.erase( { url: saveList[ item.id ].url } );
			delete saveList[ item.id ];
		}
	}
	browser.downloads.onChanged.addListener( onDownloadChanged );

	// a child has a request
	// m: message
	// p: port
	// action: about, download, resize, run
	function onPortMessage( m, p ) {
		var
			tabId = p.sender.tab.id,
			windowId = p.sender.tab.windowId;

		if (
			m.action === 'about'
		) {
			// display about.htm
			browser.tabs.create( { url: 'about.htm' } ).then( function ( t ) {
				// pull the window to the front
				browser.windows.update( t.windowId, { focused: true } );
			} );
		} else if (
			m.action === 'download' &&
			typeof m.conflictAction === 'string' &&
			typeof m.filename === 'string' &&
			typeof m.saveAs === 'boolean' &&
			typeof m.url === 'string'
		) {
			// download request
			// returns downloadItem id
			delete m.action; // APIs don't like extra members
			browser.downloads.download( m ).then( function ( id ) {
				// add download to the list
				// onCreated -> download.then -> onChanged
				// pray that then() really does run before onChanged()
				saveList[ id ] = saveList[ id ] || {};
				saveList[ id ].id = tabId;
			}, function ( err ) {
				// cancel download leads here
				// send a reply to destroy the object url
				console.error( 'onMessage:download: ' + err.toString() );
				p.postMessage( {
					action: 'download',
					url: m.url
				} );
			} );
		} else if (
			m.action === 'minimize'
		) {
			browser.windows.update( windowId, { state: 'minimized' } ).catch( function ( err ) {
				console.error( 'onMessage:minimize: ' + err.toString() );
			} );
		} else if (
			m.action === 'resize' &&
			typeof m.top === 'number' &&
			typeof m.left === 'number' &&
			typeof m.width === 'number' &&
			typeof m.height === 'number'
		) {
			// window mgmt request
			// get the current window size and location to save them
			browser.windows.get( windowId ).then( function ( w ) {
				// resize the window and send the previous size back
				delete m.action; // APIs don't like extra members
				browser.windows.update( windowId, m ).catch( function ( err ) {
					console.error( 'onMessage:update: ' + err.toString() );
				} );
				p.postMessage( {
					action: 'resize',
					top: w.top,
					left: w.left,
					width: w.width,
					height: w.height
				} );
			} );
		} else if (
			m.action === 'run' &&
			typeof m.context === 'string' &&
			typeof m.code === 'string'
		) {
			// run request
			// the active tab of the current window is the scratchpad itself
			// so find the active tab of the last focused normal window
			 browser.tabs.query( {
				active: true,
				windowId: winList[ 0 ]
			} ).then( function ( tabs ) {
				if ( m.context === 'bg' ) {
					try {
						// indirect eval invocation to move execution into global context
						// optional chaining (eval?.) was added in FF 74
						// errors reported by "new Function" are off by 2 lines
						( 0, eval )( m.code );
					} catch( err ) {
						console.error( err.name, ':', err.message, err.stack );
					}
				} else { // pg and co
					// tabs.executeScript().catch loses error line number
					// so send both page and content requests to the content context
					// for better error reporting
					browser.tabs.sendMessage( tabs[ 0 ].id, m ).catch( function ( err ) {
						// probably sendMessage couldn't send a message
						console.error( 'onMessage:run:', err );
					} );
				}
			} );
		}
	}

	// a scratchpad closed
	// or someone is experimenting
	function onPortDisconnect( p ) {
		var
			t = p.sender.tab.id;

		if ( port.hasOwnProperty( t ) ) { // it's a scratchpad
			delete port[ t ];
			browser.tabs.get( t ).then( function () {
				// a successful completion is unexpected, so log a warning
				console.warn( 'onDisconnect: unexpected port disconnection', p );
			}, nil ); // an error is expected, so do nothing
		}
	}

	// someone wants to open a connection using runtime.connect()
	// "someone" could be a user experimenting in a scratchpad
	function onRuntimeConnect( p ) {
		var
			s, t, id;

		// scratchpad.content.js opens a connection on init
		if (
			( s = p.sender ) && // Dear Reader, I want assignment
			( t = s.tab ) &&
			( id = t.id ) &&
			( port[ id ] === null ) // only new scratchpads should be null
		) {
			// someone we know (i.e., a scratchpad)
			port[ id ] = p;
			p.onDisconnect.addListener( onPortDisconnect );
			p.onMessage.addListener( onPortMessage );
			// send the latest option values right away
			p.postMessage( Object.assign( { action: 'options' }, opt ) );
		}
		// else no one we know, but don't disconnect
	}
	browser.runtime.onConnect.addListener( onRuntimeConnect );

	// handle events that affect window order
	function onWindowCreated( w ) {
		var
			id = w.id;

		if ( w.type === 'normal' ) {
			if ( w.focused ) {
				winList.unshift( id );
			} else {
				winList.push( id );
			}
		}
	}
	browser.windows.onCreated.addListener( onWindowCreated );
	function onWindowFocus( id ) {
		var
			i = winList.indexOf( id );

		if ( i > 0 ) { // no need to move the top to the top
			winList.unshift( winList.splice( i, 1 )[ 0 ] );
		}
	}
	browser.windows.onFocusChanged.addListener( onWindowFocus );
	function onWindowRemoved( id ) {
		var
			i = winList.indexOf( id );

		if ( i >= 0 ) {
			// can't get window info, because it's already gone
			winList.splice( i, 1 );
		}
	}
	browser.windows.onRemoved.addListener( onWindowRemoved );

	// wait for tabs to complete loading before injecting the extension script
	// use port[] as a semaphore initially, so injection doesn't happen twice
	function onTabsUpdated( id, _, t ) {
		// test port for true explicity, because it gets reused
		if (
			port[ id ] === true &&
			t.status === 'complete'
		) {
			port[ id ] = null;
			// inject the extension script into the new scratchpad
			browser.tabs.executeScript( id, {
				file: 'middle.js'
			} ).catch( function ( err ) {
				console.error( 'onTabsUpdated:executeScript: ' + err.toString() );
			} );
		}
	}
	browser.tabs.onUpdated.addListener( onTabsUpdated, {
		properties: [ 'status' ],
		urls: [ browser.runtime.getURL( 'scratchpad.htm' ) ]
	} );

	// when storage changes
	// make sure it's options, because a user could be experimenting
	function onOptChange( changes, _ ) {
		var
			upd = false,
			keys, i;

		// get the new option values
		keys = Object.keys( opt );
		for ( i = 0; i < keys.length; ++i ) {
			if (
				changes.hasOwnProperty( keys[ i ] ) &&
				changes[ keys[ i ] ].hasOwnProperty( 'newValue' ) &&
				optValues.hasOwnProperty( keys[ i ] ) &&
				optValues[ keys[ i ] ].includes( changes[ keys[ i ] ].newValue )
			) {
				opt[ keys[ i ] ] = changes[ keys[ i ] ].newValue;
				upd = true;
			}
		}
		if ( upd ) {
			// tell everyone
			keys = Object.keys( port );
			for ( i = 0; i < keys.length; ++i ) {
				port[ keys[ i ] ].postMessage( Object.assign( { action: 'options' }, opt ) );
			}
		}
	}

	// get stored options or use defaults
	function thenStorageGet( o ) {
		var
			keys, i;

		// only set opt members that are already defined
		keys = Object.keys( opt );
		for ( i = 0; i < keys.length; ++i ) {
			if (
				o.hasOwnProperty( keys[ i ] ) &&
				optValues.hasOwnProperty( keys[ i ] ) &&
				optValues[ keys[ i ] ].includes( o[ keys[ i ] ] )
			) {
				opt[ keys[ i ] ] = o[ keys[ i ] ];
			}
		}
		// look for members that are no longer present to remove them
		keys = Object.keys( o );
		for ( i = 0; i < keys.length; ++i ) {
			if ( !opt.hasOwnProperty( keys[ i ] ) ) {
				browser.storage.local.remove( keys[ i ] );
			}
		}
		// save the options back to storage, initializing them if first run
		browser.storage.local.set( opt ).then( function () {
			// listen for changes after setting
			// browser.storage.(local, session, etc).onChanged added in FF 101
			browser.storage.onChanged.addListener( onOptChange );
		} );
	}
	browser.storage.local.get().then( thenStorageGet );

	// normal: track normal windows to know in which one to run a scratchpad
	//         top of the list is most recently focused, etc.
	// popup:  look for pre-existing scratchpads
	//         in case the extension was restarted
	function thenWindowsGetAll( w ) {
		var
			url = browser.runtime.getURL( 'scratchpad.htm' ),
			i, t;

		for ( i = 0; i < w.length; ++i ) {
			if ( w[ i ].type === 'normal' ) {
				if ( w[ i ].focused ) {
					winList.unshift( w[ i ].id );
				} else {
					winList.push( w[ i ].id );
				}
			} else { // popup
				// check the url to verify popups are ours
				if ( ( t = w[ i ].tabs ).length === 1 && ( t = t[ 0 ] ).url === url ) {
					port[ t.id ] = null; // we got one !
					browser.tabs.executeScript( t.id, {
						file: 'middle.js'
					} ).catch( function ( err ) {
						console.error( 'windows.getAll:executeScript: ' + err.toString() );
					} );
				}
			}
		}
	};
	browser.windows.getAll( {
		populate: true,                    // tabs for popups
		windowTypes: [ 'normal', 'popup' ] // windows created as panels become popups
	} ).then( thenWindowsGetAll );

	// open a scratchpad when the menu is clicked or shortcut is typed
	// use port[] as a semaphore initially, so injection doesn't happen twice
	function onCommand() {
		browser.windows.create( {
			type: 'popup',
			width: 640,
			height: 480,
			url: 'scratchpad.htm'
		} ).then( function ( w ) {
			port[ w.tabs[ 0 ].id ] = true;
		} );
	}
	// open a scratchpad when the menu item is clicked
	browser.menus.onClicked.addListener( onCommand );
	// open a scratchpad when the shortcut is typed
	browser.commands.onCommand.addListener( onCommand );

	// create a menu item to open scratchpads
	browser.menus.create( {
		title: 'Scratchpad',
		contexts: [ 'tools_menu' ],
	}, function () {
		if ( browser.runtime.lastError ) {
			console.error( 'menus.create: ' + browser.runtime.lastError );
		}
	} );
} () );