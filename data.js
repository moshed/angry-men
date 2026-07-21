// The roster. `nick` is what the group calls him; `name` is the WhatsApp record.
// `seed2020` is his consensus average from the 2020 board (self-ranks excluded),
// which sets the default order. Two men joined after 2020 and are unseeded.
const ROSTER = [
  { nick: 'Mordy',  name: 'Mordy Goldstein',  seed2020: 2.44 },
  { nick: 'Nugsy',  name: 'Eli Ingber',       seed2020: 3.56 },
  { nick: 'Polly',  name: 'Aharon Polatoff',  seed2020: 4.00 },
  { nick: 'Elisha', name: 'Elisha Adelman',   seed2020: 4.44 },
  { nick: 'Marmz',  name: 'Avi Marmorstein',  seed2020: 5.44 },
  { nick: 'Schlam', name: 'Momo Schlam',      seed2020: 5.61 },
  { nick: 'Bob',    name: 'Bob Dov',          seed2020: 7.33 },
  { nick: 'Rubin',  name: 'Yisrael Rubin',    seed2020: 7.50 },
  { nick: 'Danzzy', name: 'Moshe Dancykier',  seed2020: 7.67 },
  { nick: 'Lowy',   name: 'Naphtali Lowy',    seed2020: 9.30 },
  { nick: 'Dogo',   name: 'Dovid Goldstein',  seed2020: 11.30 },
  { nick: 'Mansy',  name: 'Rafi Mansbach',    seed2020: 11.33 },
  { nick: 'Shaps',  name: 'Isaac Shapiro',    seed2020: null },
  { nick: 'Mayer',  name: 'Mayer Adelman',    seed2020: null },
];

const NAME_BY_NICK = Object.fromEntries(ROSTER.map((m) => [m.nick, m.name]));
const DEFAULT_BOARD = ROSTER.map((m) => m.nick);
