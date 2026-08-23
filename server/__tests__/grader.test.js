// ============================================================
// grader.test.js —— 判分核心单元测试（node:test，无外部依赖）
// 运行：npm test
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeQuestion, validateAnswerShape, questionTotalScore } from '../services/grader.js';

const singleQ = { id: 'q1', type: 'single', answer: 'B', options: [{ key: 'A' }, { key: 'B' }, { key: 'C' }, { key: 'D' }] };
const multiQ = { id: 'q2', type: 'multiple', answer: ['A', 'C', 'D'] };
const judgeQ = { id: 'q3', type: 'judge', answer: true };
const readingQ = {
  id: 'q4',
  type: 'reading',
  answer: ['B', true],
  sub_questions: [
    { id: 'q4-1', type: 'single', answer: 'B' },
    { id: 'q4-2', type: 'judge', answer: true },
  ],
};

test('单选题：答对得 1 分，答错 0 分', () => {
  const ok = gradeQuestion(singleQ, 'B');
  assert.equal(ok.isCorrect, true);
  assert.equal(ok.score, 1);
  assert.equal(ok.correctAnswer, 'B');

  const bad = gradeQuestion(singleQ, 'A');
  assert.equal(bad.isCorrect, false);
  assert.equal(bad.score, 0);
});

test('单选题：兼容数组形态答案 ["B"]', () => {
  assert.equal(gradeQuestion(singleQ, ['B']).isCorrect, true);
});

test('多选题：全对才得分，顺序无关', () => {
  assert.equal(gradeQuestion(multiQ, ['A', 'C', 'D']).isCorrect, true);
  assert.equal(gradeQuestion(multiQ, ['D', 'A', 'C']).isCorrect, true, '顺序无关');
  assert.equal(gradeQuestion(multiQ, ['A', 'C']).isCorrect, false, '少选不得分');
  assert.equal(gradeQuestion(multiQ, ['A', 'C', 'D', 'B']).isCorrect, false, '多选不得分');
  assert.equal(gradeQuestion(multiQ, ['A', 'B']).isCorrect, false, '错选不得分');
});

test('多选题分值默认 2 分', () => {
  assert.equal(gradeQuestion(multiQ, ['A', 'C', 'D']).score, 2);
});

test('判断题：布尔答案', () => {
  assert.equal(gradeQuestion(judgeQ, true).isCorrect, true);
  assert.equal(gradeQuestion(judgeQ, false).isCorrect, false);
  assert.equal(gradeQuestion(judgeQ, 'T').isCorrect, true, '兼容文本 T');
  assert.equal(gradeQuestion(judgeQ, '正确').isCorrect, true, '兼容中文');
});

test('阅读程序题：子题独立判分，全对才正确，得分累加', () => {
  const all = gradeQuestion(readingQ, ['B', true]);
  assert.equal(all.isCorrect, true);
  assert.equal(all.score, 2); // 1 + 1
  assert.equal(all.totalScore, 2);
  assert.equal(all.perSub.length, 2);

  const partial = gradeQuestion(readingQ, ['A', true]);
  assert.equal(partial.isCorrect, false);
  assert.equal(partial.score, 1, '只对一道小题得 1 分');
  assert.deepEqual(partial.correctAnswer, ['B', true]);
});

test('阅读程序题：答案数量与子题不符判 invalid', () => {
  const r = gradeQuestion(readingQ, ['B']);
  assert.equal(r.invalid, true);
});

test('答案形态校验', () => {
  assert.equal(validateAnswerShape(singleQ, 'B'), true);
  assert.equal(validateAnswerShape(singleQ, ['B']), true);
  assert.equal(validateAnswerShape(singleQ, ['A', 'B']), false);
  assert.equal(validateAnswerShape(multiQ, ['A', 'C']), true);
  assert.equal(validateAnswerShape(multiQ, 'A'), false);
  assert.equal(validateAnswerShape(judgeQ, true), true);
  assert.equal(validateAnswerShape(judgeQ, 'F'), true);
  assert.equal(validateAnswerShape(judgeQ, 'B'), false);
  assert.equal(validateAnswerShape(readingQ, ['B', true]), true);
  assert.equal(validateAnswerShape(readingQ, ['B']), false);
});

test('题目总分：默认按题型分值，reading 为子题之和', () => {
  assert.equal(questionTotalScore(singleQ), 1);
  assert.equal(questionTotalScore(multiQ), 2);
  assert.equal(questionTotalScore(judgeQ), 1);
  assert.equal(questionTotalScore(readingQ), 2);
});
