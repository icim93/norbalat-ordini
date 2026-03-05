(function () {
  // Layout fedeli ai PDF:
  // asym8 (01,02,03): col sx 3 grandi (rs 2+2+1) + col dx 5 piccole = 8 pedane
  // sym12 (04):       2 col x 6 righe uniformi                       = 12 pedane
  // ford5 (07):       4 grandi (2x2) + 1 larga in fondo              = 5 pedane
  window.PIANO_LAYOUTS = {
    asym8: {
      cols: 2, rows: 5,
      slots: [
        { n: 1, c: 0, r: 0, cs: 1, rs: 2 },
        { n: 2, c: 0, r: 2, cs: 1, rs: 2 },
        { n: 3, c: 0, r: 4, cs: 1, rs: 1 },
        { n: 4, c: 1, r: 0, cs: 1, rs: 1 },
        { n: 5, c: 1, r: 1, cs: 1, rs: 1 },
        { n: 6, c: 1, r: 2, cs: 1, rs: 1 },
        { n: 7, c: 1, r: 3, cs: 1, rs: 1 },
        { n: 8, c: 1, r: 4, cs: 1, rs: 1 },
      ]
    },
    sym12: {
      cols: 2, rows: 6,
      slots: [
        { n: 1, c: 0, r: 0, cs: 1, rs: 1 }, { n: 2, c: 1, r: 0, cs: 1, rs: 1 },
        { n: 3, c: 0, r: 1, cs: 1, rs: 1 }, { n: 4, c: 1, r: 1, cs: 1, rs: 1 },
        { n: 5, c: 0, r: 2, cs: 1, rs: 1 }, { n: 6, c: 1, r: 2, cs: 1, rs: 1 },
        { n: 7, c: 0, r: 3, cs: 1, rs: 1 }, { n: 8, c: 1, r: 3, cs: 1, rs: 1 },
        { n: 9, c: 0, r: 4, cs: 1, rs: 1 }, { n: 10, c: 1, r: 4, cs: 1, rs: 1 },
        { n: 11, c: 0, r: 5, cs: 1, rs: 1 }, { n: 12, c: 1, r: 5, cs: 1, rs: 1 },
      ]
    },
    ford5: {
      cols: 2, rows: 3,
      slots: [
        { n: 1, c: 0, r: 0, cs: 1, rs: 1 },
        { n: 2, c: 1, r: 0, cs: 1, rs: 1 },
        { n: 3, c: 0, r: 1, cs: 1, rs: 1 },
        { n: 4, c: 1, r: 1, cs: 1, rs: 1 },
        { n: 5, c: 0, r: 2, cs: 2, rs: 1 },
      ]
    }
  };
})();
