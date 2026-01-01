/**
 * replacement Scratchpad editor
 * foreground page script
 * no privileged listeners or methods
 */
(function () {
	'use strict';

	var
		reader = new FileReader(), // to "upload" inputFile into CodeMirror
		dom = {},                  // persistent DOM references
		tabSize = 2,
		lastSave,                  // last saved scratchpad history version
		editor,                    // CodeMirror object for scratchpad text
		// --- Tab Variables ---
		tabs = [],
		activeTabIndex = -1,
		divTabs,
		// --- Session Variables ---
		saveTimer; // timer for auto-saving session

	// window beforeunload
	//   confirm close if unsaved data
	function preventDefault( e ) {
		e.preventDefault();
	}

	// blur things that shouldn't keep focus
	function onFocusIn( e ) {
		e.target.blur();
	}

	// update CodeMirror cursor status
	function onInput( e ) {
		var
			cursor = e.doc.getCursor(),
			data = ( cursor.line + 1 ).toString(),
			line = e.doc.getLine( cursor.line ),
			i, t;

		if ( dom.spanLine.textContent !== data ) {
			dom.spanLine.textContent = data;
		}
		// count tabs correctly
		t = 0;
		for ( i = 0; i < cursor.ch; ++i ) {
			if ( line.charAt( i ) === '\t' ) {
				t = Math.floor( t / tabSize + 1 ) * tabSize;
			} else {
				++t;
			}
		}
		data = ( t + 1 ).toString();
		if ( dom.spanCol.textContent !== data ) {
			dom.spanCol.textContent = data;
		}

		// --- Handle Tab Dirty State ---
		if (activeTabIndex > -1) {
			var currentTab = tabs[activeTabIndex];
			var isDirty = !currentTab.doc.isClean(currentTab.lastSave);
			var title = currentTab.name;

			// Update Window Title
			var newTitle = (isDirty ? '*' : '') + title;
			if (document.title !== newTitle) {
				document.title = newTitle;
			}

			// Update Tab UI (Visual * only)
			renderTabs();

			// Manage beforeunload
			if (isDirty) {
				addEventListener( 'beforeunload', preventDefault );
			} else {
				removeEventListener( 'beforeunload', preventDefault );
			}
			
			// --- Trigger Auto-Save Session ---
			requestSessionSave();
		}
	}

	// focus the editor when the pointer enters so the cursor becomes visible
	function onPointerEnter() {
		editor.focus();
	}

	// Step #3: Success (?)
	// load the editor from a File
	// strip CRs from the text
	function onReaderLoad( e ) {
		if ( document.title[0] === '*' ) {
			removeEventListener( 'beforeunload', preventDefault );
		}

		// --- Update Active Tab Name ---
		if (activeTabIndex > -1) {
			tabs[activeTabIndex].name = dom.aDownload.download;
		}

		// CodeMirror "events" are synchronous
		// so turn off the cursor event to load a new file
		editor.off( 'cursorActivity', onInput );
		editor.doc.setValue( e.target.result.replace( /\r/g, '' ) );
		// then turn it back on
		editor.on( 'cursorActivity', onInput );

		// --- Update Save State ---
		if (activeTabIndex > -1) {
			tabs[activeTabIndex].lastSave = editor.doc.changeGeneration();
			renderTabs();
			requestSessionSave(); // Save session immediately on file load
		}
	}
	reader.addEventListener( 'load', onReaderLoad );

	// (try to) log errors
	function onReaderError( e ) {
		console.error( e.target.error.name );
	}
	reader.addEventListener( 'error', onReaderError );

	// Step #2: the file picker has picked a file
	// send it to FileReader, which is async
	function onFileChange() {
		var
			file;

		if ( dom.inputFile.files.length ) {
			file = dom.inputFile.files[ 0 ];
			reader.readAsText( file );
			// "open" is "upload," but remember the filename in the download link
			dom.aDownload.download = file.name;
		}
	}

	// Step #1a: confirm discarding unsaved changes
	function onClickDialog( e ) {
		// re-hide the dialog
		dom.divOverlay.classList = 'hidden';
		if ( e.target.id === 'buttonOK' ) {
			// pass the click from buttonOK to inputFile
			dom.inputFile.click();
		}
	}

	// Step #1: consume the click from buttonOpen
	// input type="file" sets a FileList object for FileReader
	function onClickOpen() {
		if ( document.title[0] === '*' ) {
			// unhide the modal dialog
			dom.divOverlay.classList = '';
			// focusVisible is non-standard & requires FF104
			dom.buttonCancel.focus();
		} else {
			// pass the click from buttonOpen to inputFile
			dom.inputFile.click();
		}
	}

	// the only good reason to lose focus is something else has it
	// or the modal dialog closed
	function onTimeout( e ) {
		if (
			!dom.divOverlay.querySelector( ':focus' ) &&
			!dom.divOverlay.classList.value
		) {
			// focus the last thing that had focus
			e.focus();
		}
	}

	// keep the buttons focussed in the modal dialog
	function onBlur( e ) {
		// enqueue the last thing that had focus
		setTimeout( onTimeout, 0, e.target );
	}

	// save editor to a file, using configured browser defaults
	function onClickSave() {
		var
			blob = new Blob( [ editor.doc.getValue() ], { type: 'text/plain' } ),
			t = document.title;

		// "remote" file location is a local Blob
		dom.aDownload.href = URL.createObjectURL( blob );
		dom.aDownload.click(); // click returns immediately, but it's okay
		URL.revokeObjectURL( dom.aDownload.href );
		dom.aDownload.href = '';

		if ( t[0] === '*' ) {
			removeEventListener( 'beforeunload', preventDefault );
		}

		if (activeTabIndex > -1) {
			tabs[activeTabIndex].lastSave = editor.doc.changeGeneration();
			renderTabs();
			requestSessionSave(); // Save state (dirty flag cleared)
		}
	}

	// copy the editor text to a div for printing
	// print the div, then clear it
	function onPrint() {
		var
			divPrint = document.getElementById( 'divPrint' );

		function onAfterPrint() {
			divPrint.textContent = '';
		}

		addEventListener( 'afterprint', onAfterPrint, { once: true } );
		divPrint.textContent = editor.doc.getValue();
		print();
	}

	// override default Ctrl+[JOPRS]
	function onKeydown( e ) {
		var
			focus;

		if ( e.metaKey || e.altKey ) {
			e.preventDefault(); // do nothing; probably doesn't work
		} else if ( !dom.divOverlay.classList.value ) {
			// modal is displayed
			if ( e.ctrlKey ) {
				e.preventDefault();
			} else {
				switch( e.key ) {
					case 'Escape':
						dom.buttonCancel.click(); // escape is cancel
						e.preventDefault();
					case ' ':
					case 'Enter':
						break; // space & enter default (click on focus)
					case 'ArrowLeft':
					case 'ArrowRight':
					case 'Tab':
						focus = document.querySelector( ':focus' );
						if (
							focus === dom.buttonOK &&
							e.key.match( /^(?:ArrowRight|Tab)$/ )
						) {
							dom.buttonCancel.focus(); // toggle focus
						} else if (
							focus === dom.buttonCancel &&
							e.key.match( /^(?:ArrowLeft|Tab)$/ )
						) {
							dom.buttonOK.focus(); // toggle focus
						}
					default:
						e.preventDefault(); // do nothing for most keys
				}
			}
		} else if ( e.ctrlKey && !e.shiftKey && e.key.match( /^[joprs]$/ ) ) {
			// modal is hidden
			e.preventDefault();
			if ( e.key === 'o' ) {
				onClickOpen();
			} else if ( e.key === 'p' ) {
				onPrint();
			} else if ( e.key === 'r' ) {
				document.getElementById( 'buttonRun' ).click();
			} else if ( e.key === 's' ) {
				if ( location.protocol === 'moz-extension:' ) {
					document.getElementById( 'buttonSaveAs' ).click();
				} else {
					onClickSave();
				}
			}
		}
	}
	document.addEventListener( 'keydown', onKeydown );

	// custom DOM events from the middleground script
	function onCustom( e ) {
		var
			d = e.detail;

		if ( d.action === 'download' ) {
			// download success
			removeEventListener( 'beforeunload', preventDefault );

			// --- Update Tab Save State ---
			if (activeTabIndex > -1) {
				var t = tabs[activeTabIndex];
				t.lastSave = editor.doc.changeGeneration();
				if (document.title.startsWith('*')) {
					document.title = document.title.slice(1);
				}
				renderTabs();
				requestSessionSave();
			}

		} else if ( d.action === 'tabSize' && typeof d.tabSize === 'number' ) {
			tabSize = d.tabSize;
			onInput( editor ); // to recalculate the column
		}
	}

	// --- TAB FUNCTIONS ---
	function createTab(name, content) {
		var doc = CodeMirror.Doc(content || '', 'javascript');
		return {
			name: name || 'New Script',
			doc: doc,
			lastSave: doc.changeGeneration()
		};
	}

	function renderTabs() {
		divTabs.innerHTML = '';

		tabs.forEach((t, i) => {
			var el = document.createElement('div');
			el.className = 'tab' + (i === activeTabIndex ? ' active' : '');

			// Tab Name
			var span = document.createElement('span');
			span.textContent = (t.name || 'Untitled') + (!t.doc.isClean(t.lastSave) ? ' *' : '');
			el.appendChild(span);

			// Click to Switch
			el.addEventListener('click', function(e) {
				if (!e.target.classList.contains('tab-close')) switchTab(i);
			});

			// Close Button
			var closeBtn = document.createElement('span');
			closeBtn.className = 'tab-close';
			closeBtn.textContent = '\u2715'; // ✕ (Multiplication X, looks more like an icon)
			closeBtn.addEventListener('click', function(e) {
				e.stopPropagation();
				closeTab(i);
			});
			el.appendChild(closeBtn);

			divTabs.appendChild(el);
		});

		// Add "+" Button
		var addBtn = document.createElement('div');
		addBtn.className = 'tab-add';
		addBtn.textContent = '+';
		addBtn.addEventListener('click', () => {
			var newIdx = tabs.push(createTab('scratchpad' + (tabs.length + 1) + '.js')) - 1;
			switchTab(newIdx);
			requestSessionSave(); // Save new tab creation
		});
		divTabs.appendChild(addBtn);
	}

	function switchTab(index) {
		if (index < 0 || index >= tabs.length) return;
		activeTabIndex = index;
		editor.swapDoc(tabs[index].doc);

		// Update window title for the active tab
		var current = tabs[index];
		document.title = (current.name) + (!current.doc.isClean(current.lastSave) ? '*' : '');

		// Re-attach cursor listener to the new doc
		editor.off('cursorActivity', onInput);
		editor.on('cursorActivity', onInput);
		onInput(editor); // force status bar update

		renderTabs();
		editor.focus();
		requestSessionSave(); // Save active tab switch
	}

	function closeTab(index) {
		if (tabs.length === 1) return; // Don't close last tab
		var switchNeeded = (index === activeTabIndex);
		tabs.splice(index, 1);

		if (switchNeeded) {
			switchTab(Math.max(0, index - 1));
		} else if (index < activeTabIndex) {
			activeTabIndex--;
			renderTabs();
		} else {
			renderTabs();
		}
		requestSessionSave(); // Save tab deletion
	}

	// --- SESSION MANAGEMENT (Auto-Save) ---
	function requestSessionSave() {
		// Debounce: Wait 1s after last action before writing to disk
		clearTimeout(saveTimer);
		saveTimer = setTimeout(saveSessionToStorage, 1000);
	}

	function saveSessionToStorage() {
		// Serialize tabs to simple objects (text only, no history)
		var sessionData = {
			tabs: tabs.map(t => ({
				name: t.name,
				content: t.doc.getValue()
			})),
			activeIndex: activeTabIndex
		};
		// Save to browser storage
		browser.storage.local.set({ 'scratchpadSession': sessionData });
	}

	function restoreSession() {
		return browser.storage.local.get('scratchpadSession').then(function(res) {
			if (res && res.scratchpadSession && res.scratchpadSession.tabs && res.scratchpadSession.tabs.length > 0) {
				var s = res.scratchpadSession;
				
				// Recreate tabs from storage
				tabs = [];
				s.tabs.forEach(function(savedTab) {
					tabs.push(createTab(savedTab.name, savedTab.content));
				});

				// Restore active index
				if (s.activeIndex >= 0 && s.activeIndex < tabs.length) {
					switchTab(s.activeIndex);
				} else {
					switchTab(0);
				}
				return true; // Session restored
			}
			return false; // No session found
		});
	}


	// document.ready( function )
	function onContentLoaded() {
		var
			extraKeys = { //remap Tab and Shift-Tab in default map
				Tab: function ( e ) {
					if ( e.getOption( 'keyMap' ) !== 'default' ) {
						return CodeMirror.Pass;
					}
					if ( e.somethingSelected() ) {
						e.indentSelection( 'add' );        // indentMore
					} else if ( e.getOption( 'indentWithTabs' ) ) {
						e.replaceSelection( '\t', 'end' ); // insertTab
					} else {
						e.execCommand( 'insertSoftTab' );
					}
				},
				'Shift-Tab': function ( e ) {
					if ( e.getOption( 'keyMap' ) !== 'default' ) {
						return CodeMirror.Pass;
					}
					e.indentSelection( 'subtract' );     // indentLess
				}
			},
			e;

		// initialize persistent DOM references
		dom.aDownload = document.getElementById( 'aDownload' );
		dom.buttonCancel = document.getElementById( 'buttonCancel' );
		dom.buttonOK = document.getElementById( 'buttonOK' );
		dom.divOverlay = document.getElementById( 'divOverlay' );
		dom.inputFile = document.getElementById( 'inputFile' );
		dom.spanLine = document.getElementById( 'spanLine' );
		dom.spanCol = document.getElementById( 'spanCol' );

		// --- Init Tabs DOM ---
		divTabs = document.getElementById('divTabs');

		// construct a CodeMirror that replaces the div placeholder
		editor = CodeMirror( function ( e ) {
			document.body.replaceChild(
				e,
				document.getElementsByClassName( 'CodeMirror' )[ 0 ]
			);
		}, {
			autoCloseBrackets: true,
			autofocus: true,
			extraKeys: extraKeys,
			indentUnit: tabSize,
			indentWithTabs: true,
			lineNumbers: true,
			matchBrackets: true,
			styleActiveLine: true,
			tabSize: tabSize,
			value: '' // Value handled by Tabs
		} );

		// Event Listeners for Editor
		document.getElementsByClassName( 'CodeMirror' )[ 0 ].addEventListener(
			'pointerenter', onPointerEnter
		);
		// capture input events for cursor status
		editor.on( 'cursorActivity', onInput );


		// --- RESTORE SESSION OR DEFAULT ---
		// We try to restore the session. If it fails or is empty, we create a default tab.
		restoreSession().then(function(success) {
			if (!success) {
				tabs.push(createTab('scratchpad.js', '// This is a JavaScript scratchpad.\n( function () {} () );'));
				switchTab(0);
			}
		});
		// ----------------------------------


		// keep focus out of the button bar
		document.getElementById( 'divButtons' ).addEventListener( 'focusin', onFocusIn );

		// capture context menu events (to kill it for now)
		document.body.addEventListener( 'contextmenu', preventDefault );

		// check why focus was lost and possibly restore it
		dom.buttonOK.addEventListener( 'blur', onBlur );
		dom.buttonCancel.addEventListener( 'blur', onBlur );

		// file Open is really file upload
		document.getElementById( 'buttonOpen' ).addEventListener( 'click', onClickOpen );
		dom.buttonOK.addEventListener( 'click', onClickDialog );
		dom.buttonCancel.addEventListener( 'click', onClickDialog );
		
		// capture input type="file" change when it opens a file
		dom.inputFile.addEventListener( 'change', onFileChange );

		if ( location.protocol === 'moz-extension:' ) {
			// listen for events from the middleground
			document.addEventListener( 'middle', onCustom );
		} else { // file: or http:
			e = document.getElementById( 'buttonSave' );
			e.addEventListener( 'click', onClickSave );
			e.title = 'Ctrl-S';
		}
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', onContentLoaded, { once: true } );
	} else {
		onContentLoaded();
	}
}());