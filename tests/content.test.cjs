const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]+)<\/script>/)[1];
const data = vm.runInNewContext(script.split("$('buildTab').addEventListener")[0] +
  '\nvalidate(); ({ PROOFS, ERRORS, FIND_REASON, FIX_DISTRACTORS, STORE })', {
  localStorage: { getItem: () => null }
});
const { PROOFS, ERRORS, FIND_REASON, FIX_DISTRACTORS, STORE } = JSON.parse(JSON.stringify(data));

test('existing IDs, levels and storage key are compatible', () => {
  const ids = (prefix, count) => Array.from({length: count}, (_, i) =>
    prefix + String(i + 1).padStart(2, '0'));
  assert.deepEqual(PROOFS.basic.map(x => x.id), ids('b', 8));
  assert.deepEqual(PROOFS.advanced.map(x => x.id), ids('a', 13));
  assert.deepEqual(ERRORS.basic.map(x => x.id), ids('e', 8));
  assert.deepEqual(ERRORS.advanced.map(x => x.id), ids('f', 8));
  assert.equal(STORE, 'shoumei-builder-v4-buttons');
});

test('every guided and repair question has distinct choices and feedback', () => {
  for (const mission of [...PROOFS.basic, ...PROOFS.advanced]) {
    assert.equal(mission.steps.length, 5, mission.id);
    assert.equal(new Set(mission.steps.map(step => step.correct)).size, 5, mission.id);
    for (const step of mission.steps) {
      assert.equal(new Set([step.correct, ...step.wrong]).size, 4, mission.id);
      assert.ok(step.why.trim(), mission.id);
    }
  }
  for (const mission of [...ERRORS.basic, ...ERRORS.advanced]) {
    assert.equal(new Set([mission.fix, mission.lines[mission.wrong], ...FIX_DISTRACTORS[mission.id]]).size, 4);
    assert.ok(mission.reason.trim() && FIND_REASON[mission.id].trim(), mission.id);
  }
});

// These are algebraic expressions taken from the displayed choices, not copies
// of the expected results. Sampling detects counterexamples to distractors.
function value(expression, variables) {
  const source = expression.replace(/＋/g, '+').replace(/－/g, '-').replace(/×/g, '*')
    .replace(/³/g, '**3').replace(/⁵/g, '**5')
    .replace(/(?<=[0-9a-z)])(?=[a-z(])/g, '*');
  assert.match(source, /^[0-9a-dkmn+*() -]+$/);
  return vm.runInNewContext(source, variables);
}

test('the 7-remainder choices identify their corresponding numbers', () => {
  const first = PROOFS.basic.find(x => x.id === 'b08').steps[0];
  const residue = number => ((number % 7) + 7) % 7;
  const sample = [-3, -1, 0, 1, 3];
  function valid(text) {
    const [mExpression, nExpression] = text.match(/[0-9][mn][＋0-9]*/g);
    return sample.every(m => sample.every(n =>
      residue(value(mExpression, {m, n})) === 3 && residue(value(nExpression, {m, n})) === 4));
  }
  assert.equal(valid(first.correct), true);
  assert.ok(first.wrong.every(text => !valid(text)));
});

test('e01 has independent odd integers and uses the actual quotient by 2', () => {
  const mission = ERRORS.basic.find(x => x.id === 'e01');
  const repaired = mission.lines.map((line, i) => i === mission.wrong ? mission.fix : line);
  assert.match(repaired[0], /m、n を整数/);
  assert.match(repaired[1], /2m＋1、2n＋1/);
  assert.match(mission.lines[1], /2m＋1 と 2m＋1/);
  const equation = repaired[2].match(/([0-9mn＋()]+)＝([0-9mn＋()]+)/);
  for (const m of [-2, 0, 2]) {
    for (const n of [-3, 0, 3]) {
      assert.equal(value(equation[1], {m, n}), value(equation[2], {m, n}));
    }
  }
  assert.match(repaired[3], /m＋n＋1 は整数だから、2\(m＋n＋1\) は偶数/);
});

test('explicit polynomial equalities in guided choices have one valid option', () => {
  const assignments = [
    {a: 1, b: 0, c: 0, k: 1, m: -2, n: -1},
    {a: 2, b: 3, c: 4, k: 1, m: 1, n: 3},
    {a: 8, b: 5, c: 2, k: 2, m: 2, n: 5},
    {a: 7, b: 9, c: 1, k: 2, m: 3, n: 2},
  ];
  function equation(text) {
    return text.match(/[0-9a-ckmn＋－×()³⁵]+(?:＝[0-9a-ckmn＋－×()³⁵]+)+/)?.[0].split('＝');
  }
  let checked = 0;
  for (const mission of [...PROOFS.basic, ...PROOFS.advanced]) {
    for (const step of mission.steps) {
      const equations = [step.correct, ...step.wrong].map(equation);
      if (!equations.every(terms => terms && !/^[a-d]$/.test(terms[0])) ||
          (mission.id === 'a04' && step.label.startsWith('条件'))) continue;
      // Some options begin after a verbal label ("和は"); check the
      // displayed equality and leave the stated operation to content review.
      const valid = equations.map(terms => assignments.every(vars =>
        new Set(terms.map(term => value(term, vars))).size === 1));
      assert.deepEqual(valid, [true, false, false, false], mission.id + ' ' + step.label);
      checked++;
    }
  }
  assert.ok(checked >= 10, checked);
});
