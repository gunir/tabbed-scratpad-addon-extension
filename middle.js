/**
 * replacement Scratchpad editor
 * "middleground" page script
 * restartable privileged listeners and methods
 * the content context is less privileged than the page context
 *   when the page loads from the extension
 */
(function () {
	'use strict';

	var
		port = browser.runtime.connect(),
		editor = document.getElementsByClassName( 'CodeMirror' )[ 0 ].CodeMirror,
		dom = {},     // persistent DOM references
		windowNormal; // last normal (unmaximized) window location and size

	// handle option updates
	function setOptions( m ) {
		var
			i, keys;

		// easier to set all font sizes +1, then decrement for CodeMirror in CSS
		dom.style.textContent = dom.style.textContent.replace(
			/sans-size: \d+/,
			'sans-size: ' + ( m.fontSize + 1 )
		).replace(
			/tab-size: \d+/,
			'tab-size: ' + m.tabSize
		);
		if ( editor.getOption( 'tabSize' ) !== m.tabSize ) {
			// tell the foreground script
			document.dispatchEvent( new CustomEvent( 'middle', { detail: {
				action: 'tabSize',
				tabSize: m.tabSize
			} } ) );
		}
		editor.setOption( 'indentUnit', m.tabSize );
		delete m.action;   // not CM options
		delete m.fontSize;
		keys = Object.keys( m );
		for ( i = 0; i < keys.length; ++i ) {
			editor.setOption( keys[ i ], m[ keys[ i ] ] );
		}
		editor.doc.cm.refresh(); // recalculate cached values
	}

	// receive messages: download, options, resize
	function onPortMessage( m ) {
		if (
			m.action === 'download' &&
			typeof m.url === 'string'
		) {
			// download sent a reply
			URL.revokeObjectURL( m.url );
			if ( typeof m.filename === 'string' ) {
				// signal success to the foreground script
				document.dispatchEvent( new CustomEvent( 'middle', { detail: {
					action: 'download'
				} } ) );
				document.title = m.filename;
			}
		} else if (
			m.action === 'options' &&
			typeof m.autoCloseBrackets === 'boolean' &&
			typeof m.indentWithTabs === 'boolean' &&
			typeof m.fontSize === 'number' &&
			typeof m.tabSize === 'number' &&
			typeof m.keyMap === 'string'
		) {
			// open connection or option change sent options
			setOptions( m );
		} else if (
			m.action === 'resize' &&
			typeof m.top === 'number' &&
			typeof m.left === 'number' &&
			typeof m.width === 'number' &&
			typeof m.height === 'number'
		) {
			// resize sent a reply
			windowNormal = m;
		}
	}
	port.onMessage.addListener( onPortMessage );

	// "save" is "download"
	// "remote" file location is the editor
	// "Save" works like "ask every time" browser option is unchecked
	//   i.e., saves silently to the Download directory & always replaces
	// "Save As ..." works like "ask every time" is checked
	//   i.e., opens a file picker and asks to replace
	function onClickSave( e ) {
		var
			t = document.title;

		if ( t[0] === '*' ) {
			t = t.slice( 1 );
		}
		// browser.downloads doesn't exist in content
		port.postMessage( {
			action: 'download',
			conflictAction: 'overwrite',
			filename: t,
			saveAs: e.type === 'keydown' || e.target.textContent !== 'Save',
			url: URL.createObjectURL( new Blob(
				[ editor.doc.getValue() ],
				{ type: 'text/plain' }
			) )
		} );
	}

	// (try to) inject code into the active tab or background
	function onClickRun() {
		// browser.tabs doesn't exist in content
		port.postMessage( {
			action: 'run',
			context: dom.formMenu.context.value,
			code: editor.doc.getValue()
		} );
	}

	// window size management
	// "state: maximized" appears to be broken
	// makes the window too large for the screen
	// so "state: normal" won't work, either
	function onClickResize() {
		if ( dom.svgMax.className === 'hidden' ) {
			// normalize was clicked
			dom.svgMax.classList.remove( 'hidden' );
			dom.svgNorm.classList.add( 'hidden' );
			port.postMessage( windowNormal ); // action is already set
		} else {
			// mazimize was clicked
			dom.svgMax.classList.add( 'hidden' );
			dom.svgNorm.classList.remove( 'hidden' );
			// browser.windows doesn't exist in content
			port.postMessage( {
				action: 'resize',
				top: screen.availTop,
				left: screen.availLeft,
				width: screen.availWidth,
				height: screen.availHeight
			} );
		}
	}

	// have the background display "about" info
	function onAbout() {
		port.postMessage( {
			action: 'about'
		} );
	}

	function onClickMinimize() {
		port.postMessage( {
			action: 'minimize'
		} );
	}

	// add privileged listeners and update the UI
	// define operations so that they can be rerun, like upon restarting
	function init() {
		// unhook listeners that don't exists anymore
		// cloneNode doesn't clone listeners
		// so replace everything with identical clones that watch and listen
		// except for the brain implants
		function capgras( id, listener ) {
			var
				domOld, domNew;

			domOld = document.getElementById( id );
			domNew = domOld.cloneNode( true );
			domNew.removeAttribute( 'class' ); // unhide
			domNew.addEventListener( 'click', listener );
			domOld.parentNode.replaceChild( domNew, domOld );
		}

		capgras( 'buttonSave', onClickSave );
		capgras( 'buttonSaveAs', onClickSave );
		capgras( 'buttonRun', onClickRun );
		capgras( 'buttonMax', onClickResize );
		capgras( 'buttonMin', onClickMinimize ); // <--- ADD THIS LINE
		capgras( 'menuAbout', onAbout );

		// initialize persistent DOM references
		dom.formMenu = document.getElementById( 'formMenu' );
		dom.style =  document.getElementById( 'style' );
		dom.svgMax =  document.getElementById( 'svgMax' );   // the clone
		dom.svgNorm =  document.getElementById( 'svgNorm' ); // the clone

		// unhide maximize/normalize and settings
		document.getElementById( 'spanRight' ).removeAttribute( 'class' );
	}
	init();
}());