export const DRIVERS = [
  { name: 'Rui Barreto', code: 'BAR', spd: 5, foc: 2, cost: 40, trait: 'hot',
    tn: 'HOT HEAD', td: 'Devastating on a charge, but pushing winds him up fast.' },
  { name: '\u00C9mile Rocard', code: 'ROC', spd: 4, foc: 4, cost: 34, trait: 'rain',
    tn: 'RAIN MASTER', td: 'Half the risk of everyone else when the sky opens.' },
  { name: 'Tommy Vale', code: 'VAL', spd: 4, foc: 2, cost: 24, trait: 'wild',
    tn: 'WILDCARD', td: 'Blistering one weekend, anonymous the next.' },
  { name: 'Heinz Adler', code: 'ADL', spd: 3, foc: 5, cost: 22, trait: 'metro',
    tn: 'METRONOME', td: 'Rarely puts a wheel wrong. Brings the car home.' },
  { name: 'Nikos Vane', code: 'VAN', spd: 3, foc: 3, cost: 14, trait: 'fear',
    tn: 'FEARLESS', td: 'Sees gaps others don\u2019t. Sometimes they aren\u2019t there.' },
  { name: 'Beto Cruz', code: 'CRU', spd: 3, foc: 2, cost: 12, trait: 'pay',
    tn: 'PAY DRIVER', td: 'His backers wire the team $5k after every race.' },
  { name: 'Sal Moreno', code: 'MOR', spd: 2, foc: 4, cost: 8, trait: 'tyre',
    tn: 'TYRE WHISPERER', td: 'Tyres last 20% longer under his care.' },
  { name: 'Jack Mills', code: 'MIL', spd: 2, foc: 2, cost: 5, trait: 'rookie',
    tn: 'ROOKIE', td: 'Cheap, keen, and completely unproven.' }
];
export const ENGINEERS = [
  { name: 'Margit Krause', exp: 5, prec: 2, cost: 16, td: 'Brilliant, erratic. Big tuning windows, wild tuning steps.' },
  { name: 'Ada Okoye', exp: 3, prec: 4, cost: 12, td: 'Methodical. Parts wear slowly, tuning steps are predictable.' },
  { name: 'V\u00EDctor P\u00E1ez', exp: 2, prec: 2, cost: 6, td: 'Does the job. Nothing more, nothing less.' }
];
export const CHIEFS = [
  { name: 'Dee Brand', skill: 5, foc: 3, cost: 14, td: 'Fastest hands in the lane \u2014 when nothing goes wrong.' },
  { name: 'Ryo Sato', skill: 3, foc: 5, cost: 10, td: 'A touch slower, but the stop never goes wrong.' },
  { name: 'Edu Silva', skill: 2, foc: 2, cost: 5, td: 'Budget option. Keep expectations grounded.' }
];
export const PHILS = [
  { name: 'Conservative', wear: 0.007, upg: 1.25, freeE: 0,
    td: 'Parts wear slowly. Upgrades cost 25% more. Finishes races.' },
  { name: 'Balanced', wear: 0.011, upg: 1.0, freeE: 0,
    td: 'Middle of the road in every sense.' },
  { name: 'Experimental', wear: 0.016, upg: 0.75, freeE: 1,
    td: 'Free engine level, cheap upgrades \u2014 and parts that wear out fast.' }
];
export const SPONSORS = [
  { name: 'Vela Motor Oil', race: 12, bonus: 6, cond: 'both', td: '$12k per race. +$6k when both cars finish.' },
  { name: 'Aurora Films', race: 15, bonus: 8, cond: 'top5', td: '$15k per race. +$8k when a car finishes top 5.' },
  { name: 'Banco Metro', race: 9, bonus: 20, cond: 'podium', td: '$9k per race. +$20k for every podium.' }
];
