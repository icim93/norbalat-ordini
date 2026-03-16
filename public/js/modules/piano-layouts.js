(function () {
  // Layout fedeli ai PDF:
  // asym8 (01,02,03): col sx 3 grandi (rs 2+2+1) + col dx 5 piccole = 8 pedane
  // sym12 (04):       2 col x 6 righe uniformi                       = 12 pedane
  // ford5 (07):       4 grandi (2x2) + 1 larga in fondo              = 5 pedane
  window.PIANO_LAYOUTS = {
    asym8: {
      cols: 9, rows: 20,
      columnTemplate: '4fr 5fr',
      legend: '3 pedane per lungo a sinistra, 5 di piatto a destra, spazio libero dietro a sinistra',
      slots: [
        { n: 1, c: 0, r: 0, cs: 1, rs: 5, lane: 'sinistra', orientation: 'lungo' },
        { n: 2, c: 0, r: 5, cs: 1, rs: 5, lane: 'sinistra', orientation: 'lungo' },
        { n: 3, c: 0, r: 10, cs: 1, rs: 5, lane: 'sinistra', orientation: 'lungo' },
        { n: 4, c: 1, r: 0, cs: 1, rs: 4, lane: 'destra', orientation: 'piatto' },
        { n: 5, c: 1, r: 4, cs: 1, rs: 4, lane: 'destra', orientation: 'piatto' },
        { n: 6, c: 1, r: 8, cs: 1, rs: 4, lane: 'destra', orientation: 'piatto' },
        { n: 7, c: 1, r: 12, cs: 1, rs: 4, lane: 'destra', orientation: 'piatto' },
        { n: 8, c: 1, r: 16, cs: 1, rs: 4, lane: 'destra', orientation: 'piatto' },
      ]
    },
    sym12: {
      cols: 2, rows: 6,
      columnTemplate: '1fr 1fr',
      legend: 'Due colonne speculari da 6 pedane',
      slots: [
        { n: 1, c: 0, r: 0, cs: 1, rs: 1, lane: 'sinistra' }, { n: 2, c: 1, r: 0, cs: 1, rs: 1, lane: 'destra' },
        { n: 3, c: 0, r: 1, cs: 1, rs: 1, lane: 'sinistra' }, { n: 4, c: 1, r: 1, cs: 1, rs: 1, lane: 'destra' },
        { n: 5, c: 0, r: 2, cs: 1, rs: 1, lane: 'sinistra' }, { n: 6, c: 1, r: 2, cs: 1, rs: 1, lane: 'destra' },
        { n: 7, c: 0, r: 3, cs: 1, rs: 1, lane: 'sinistra' }, { n: 8, c: 1, r: 3, cs: 1, rs: 1, lane: 'destra' },
        { n: 9, c: 0, r: 4, cs: 1, rs: 1, lane: 'sinistra' }, { n: 10, c: 1, r: 4, cs: 1, rs: 1, lane: 'destra' },
        { n: 11, c: 0, r: 5, cs: 1, rs: 1, lane: 'sinistra' }, { n: 12, c: 1, r: 5, cs: 1, rs: 1, lane: 'destra' },
      ]
    },
    ford5: {
      cols: 2, rows: 3,
      columnTemplate: '1fr 1fr',
      legend: '4 pedane in griglia e una larga sul fondo',
      slots: [
        { n: 1, c: 0, r: 0, cs: 1, rs: 1, lane: 'sinistra' },
        { n: 2, c: 1, r: 0, cs: 1, rs: 1, lane: 'destra' },
        { n: 3, c: 0, r: 1, cs: 1, rs: 1, lane: 'sinistra' },
        { n: 4, c: 1, r: 1, cs: 1, rs: 1, lane: 'destra' },
        { n: 5, c: 0, r: 2, cs: 2, rs: 1, lane: 'centrale' },
      ]
    }
  };
})();
