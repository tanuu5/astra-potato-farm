// 曲のデータ（書き方は sequencer.js の先頭）。1 小節 = 16 トークン。
// 繰り返し聞く曲は 8 小節前後にして、最後の小節 → 最初の小節のつなぎ目が自然に聞こえるようにする。
//   title：のんびり（Cmaj7 - Am7 - Fmaj7 - G）／ day：畑しごと（F）／ night：夜（Am）／ boss：大きいのが来る夜（Dm）
//   report：1 日のおわり（1 回だけ）／ ending：5 日間のおわり

const R = '. . . . . . . . . . . . . . . .';

export const SONGS = {
  title: {
    id: 'title', bpm: 80, gain: 0.85,
    tracks: {
      pad: { inst: 'pad', vol: 0.7, bars: [
        'C4+E4+G4+B4 - - - - - - - - - - - - - - -',
        'A3+C4+E4+G4 - - - - - - - - - - - - - - -',
        'F3+A3+C4+E4 - - - - - - - - - - - - - - -',
        'G3+B3+D4+E4 - - - - - - - - - - - - - - -',
      ] },
      pluck: { inst: 'pluck', vol: 0.45, pan: 0.2, bars: [
        'C5 . G4 . E5 . G4 . B4 . G4 . E5 . D5 .',
        'A4 . E4 . C5 . E4 . G4 . E4 . C5 . B4 .',
        'F4 . C5 . A4 . C5 . E5 . C5 . A4 . G4 .',
        'G4 . D5 . B4 . D5 . E5 . D5 . B4 . . .',
      ] },
      bell: { inst: 'bell', vol: 0.5, pan: -0.2, bars: [
        'E6 - - - . . . . G6 - - - . . . .',
        '. . . . C6 - - - . . . . B5 - - -',
        'A5 - - - . . . . C6 - - - . . . .',
        'B5 - - - - - - - . . . . . . . .',
        'E6 - - - . . . . D6 - - - . . . .',
        '. . . . C6 - - - . . . . E6 - - -',
        'F6 - - - . . . . E6 - - - C6 - - -',
        'D6 - - - - - - - . . . . . . . .',
      ] },
      bass: { inst: 'bass', vol: 0.35, bars: ['C2 - - - - - - - . . . . . . . .', 'A1 - - - - - - - . . . . . . . .', 'F1 - - - - - - - . . . . . . . .', 'G1 - - - - - - - . . . . . . . .'] },
    },
  },
  day: {
    id: 'day', bpm: 108, gain: 0.7,
    tracks: {
      drums: { inst: 'drums', vol: 0.55, bars: [
        { kick: 'x.......x.......', hat: '..o...o...o...o.' },
        { kick: 'x.......x.....o.', hat: '..o...o...o.o.o.' },
      ] },
      bass: { inst: 'bass', vol: 0.45, bars: [
        'F2 . . . C3 . . . F2 . . . C3 . A2 .',
        'C2 . . . G2 . . . C2 . . . G2 . E2 .',
        'D2 . . . A2 . . . D2 . . . A2 . F2 .',
        'Bb1 . . . F2 . . . Bb1 . . . C2 . E2 .',
        'F2 . . . C3 . . . F2 . . . C3 . A2 .',
        'C2 . . . G2 . . . C2 . . . G2 . E2 .',
        'Bb1 . . . F2 . . . Bb1 . . . D2 . F2 .',
        'C2 . . . G2 . . . C2 . E2 . G2 . . .',
      ] },
      chords: { inst: 'pluck', vol: 0.32, pan: 0.25, bars: [
        '. . A4+C5 . . . A4+C5 . . . A4+C5 . . . A4+C5 .',
        '. . G4+C5 . . . G4+C5 . . . G4+E5 . . . G4+C5 .',
        '. . F4+A4 . . . F4+A4 . . . F4+D5 . . . F4+A4 .',
        '. . F4+Bb4 . . . F4+Bb4 . . . G4+C5 . . . G4+Bb4 .',
        '. . A4+C5 . . . A4+C5 . . . A4+C5 . . . A4+C5 .',
        '. . G4+C5 . . . G4+C5 . . . G4+E5 . . . G4+C5 .',
        '. . F4+Bb4 . . . F4+Bb4 . . . F4+D5 . . . F4+Bb4 .',
        '. . G4+C5 . . . G4+C5 . . . G4+E5 . . . G4+Bb4 .',
      ] },
      lead: { inst: 'lead', vol: 0.42, pan: -0.15, bars: [
        'C5 - A4 - C5 - F5 - - - E5 - D5 - C5 -',
        'E5 - - - D5 - C5 - D5 - - - . . . .',
        'D5 - F5 - A5 - - - G5 - F5 - E5 - D5 -',
        'F5 - - - - - - - . . . . C5 - E5 -',
        'F5 - E5 - F5 - A5 - - - G5 - F5 - E5 -',
        'G5 - - - E5 - C5 - E5 - - - . . . .',
        'D5 - - - F5 - - - Bb4 - D5 - F5 - E5 -',
        'E5 - - - - - - - . . . . . . . .',
      ] },
    },
  },
  night: {
    id: 'night', bpm: 76, gain: 0.75,
    tracks: {
      pad: { inst: 'pad', vol: 0.55, bars: [
        'A3+C4+E4 - - - - - - - - - - - - - - -',
        'F3+A3+C4 - - - - - - - - - - - - - - -',
        'G3+B3+D4 - - - - - - - - - - - - - - -',
        'E3+G3+B3 - - - - - - - - - - - - - - -',
      ] },
      arp: { inst: 'pluck', vol: 0.4, pan: 0.2, bars: [
        'A3 . E4 . A4 . C5 . E5 . C5 . A4 . E4 .',
        'F3 . C4 . F4 . A4 . C5 . A4 . F4 . C4 .',
        'G3 . D4 . G4 . B4 . D5 . B4 . G4 . D4 .',
        'E3 . B3 . E4 . G4 . B4 . G4 . E4 . B3 .',
      ] },
      bell: { inst: 'bell', vol: 0.4, pan: -0.25, bars: [
        'E5 - - - - - - - . . . . . . . .',
        '. . . . . . . . C5 - - - - - - -',
        'D5 - - - - - - - . . . . B4 - - -',
        R,
      ] },
      bass: { inst: 'bass', vol: 0.3, bars: ['A1 - - - - - - - - - - - - - - -', 'F1 - - - - - - - - - - - - - - -', 'G1 - - - - - - - - - - - - - - -', 'E1 - - - - - - - - - - - - - - -'] },
    },
  },
  boss: {
    id: 'boss', bpm: 126, gain: 0.72,
    tracks: {
      drums: { inst: 'drums', vol: 0.75, bars: [
        { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
        { kick: 'x...x...x...x.x.', snare: '....x.......x..o', hat: 'x.x.x.x.x.x.xxxx' },
      ] },
      bass: { inst: 'bass', vol: 0.6, bars: [
        'D2 . D2 . D3 . D2 . D2 . D2 . C3 . A2 .',
        'Bb1 . Bb1 . Bb2 . Bb1 . C2 . C2 . C3 . A1 .',
      ] },
      pad: { inst: 'pad', vol: 0.35, bars: ['D3+F3+A3 - - - - - - - - - - - - - - -', 'Bb2+D3+F3 - - - - - - - C3+E3+G3 - - - - - - -'] },
      lead: { inst: 'lead', vol: 0.5, pan: -0.1, bars: [
        'D5 - - F5 - - A5 - G5 - F5 - E5 - - -',
        'F5 - - E5 - - D5 - C5 - - - A4 - - -',
        'D5 - - F5 - - A5 - D6 - C6 - A5 - - -',
        'Bb5 - - A5 - - G5 - A5 - - - - - - -',
      ] },
    },
  },
  report: {
    id: 'report', bpm: 120, gain: 0.85, loop: false, bars: 2,
    tracks: {
      pluck: { inst: 'pluck', vol: 0.7, bars: ['C5 E5 G5 C6 - - - - . . . . . . . .', R] },
      bell: { inst: 'bell', vol: 0.6, bars: ['. . . . C6+E6+G6 - - - - - - - . . . .', R] },
      pad: { inst: 'pad', vol: 0.5, bars: ['C4+E4+G4 - - - - - - - - - - - - - - -', R] },
    },
  },
  ending: {
    id: 'ending', bpm: 92, gain: 0.8,
    tracks: {
      pad: { inst: 'pad', vol: 0.55, bars: [
        'C4+E4+G4 - - - - - - - - - - - - - - -',
        'B3+D4+G4 - - - - - - - - - - - - - - -',
        'A3+C4+E4 - - - - - - - - - - - - - - -',
        'F3+A3+C4 - - - - - - - - - - - - - - -',
        'C4+E4+G4 - - - - - - - - - - - - - - -',
        'B3+D4+G4 - - - - - - - - - - - - - - -',
        'F3+A3+C4 - - - - - - - G3+B3+D4 - - - - - - -',
        'C4+E4+G4 - - - - - - - - - - - - - - -',
      ] },
      arp: { inst: 'pluck', vol: 0.38, pan: 0.2, bars: [
        'C4 . G4 . C5 . E5 . G4 . C5 . E5 . G5 .',
        'G3 . D4 . G4 . B4 . D4 . G4 . B4 . D5 .',
        'A3 . E4 . A4 . C5 . E4 . A4 . C5 . E5 .',
        'F3 . C4 . F4 . A4 . C4 . F4 . A4 . C5 .',
      ] },
      bell: { inst: 'bell', vol: 0.5, pan: -0.2, bars: [
        'E5 - - - G5 - - - C6 - - - B5 - G5 -',
        'D5 - - - - - - - . . . . G5 - A5 -',
        'C6 - - - B5 - A5 - E5 - - - . . . .',
        'F5 - - - A5 - - - C6 - - - A5 - - -',
        'G5 - - - E5 - - - C5 - - - E5 - G5 -',
        'D6 - - - - - - - B5 - - - G5 - - -',
        'A5 - - - C6 - - - F5 - - - A5 - - -',
        'C6 - - - - - - - - - - - . . . .',
      ] },
      bass: { inst: 'bass', vol: 0.35, bars: ['C2 - - - - - - - C2 - - - . . . .', 'G1 - - - - - - - G1 - - - . . . .', 'A1 - - - - - - - A1 - - - . . . .', 'F1 - - - - - - - F1 - - - . . . .'] },
    },
  },
};
