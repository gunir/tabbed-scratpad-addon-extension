/**
 * replacement Scratchpad editor
 * privileged tab script
 */
(function () {
	'use strict';

	// run code in the page (main) or content (isolated) context
	function onRuntimeMessage( m ) {
		if (
			m.action === 'run' &&
			typeof m.context === 'string' &&
			typeof m.code === 'string'
		) {
			try {
				if ( m.context === 'co' ) {
					// indirect eval invocation to move execution into
					//   (quasi) global context (out of this function, at least)
					// chaining (eval?.) wasn't added until FF 74
					// errors reported by "new Function" are off by 2 lines
					( 0, eval )( m.code );
				} else { // m.context === 'pg'
					window.eval( m.code );
				}
			} catch( err ) {
				console.error( err.name, ':', err.message, err.stack );
			}
		}
	}
	if ( outerWidth > 0 ) { // real window?
		browser.runtime.onMessage.addListener( onRuntimeMessage );
	}
} () );