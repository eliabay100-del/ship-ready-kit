#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

/**
 * Structural check for the 53-row invariant matrix.
 * It validates shape, not truth: priorities, required fields, and unique ids.
 */

const matrixPath = new URL('../53-invariants.yml', import.meta.url);
const doc = parse(readFileSync(matrixPath, 'utf8'));
const errors = [];

const priorities = new Set(['P0', 'P1', 'P2', 'P3']);
const rows = doc?.invariants;

if (!doc || typeof doc !== 'object') {
  errors.push('document is not a mapping');
}

if (doc?.meta?.version !== 1) {
  errors.push('meta.version must be 1');
}

if (!Array.isArray(rows)) {
  errors.push('invariants must be a list');
} else {
  if (rows.length !== 53) {
    errors.push(`expected 53 invariants, found ${rows.length}`);
  }

  const ids = new Set();
  const names = new Set();

  rows.forEach((row, index) => {
    const at = `row ${index + 1}${row?.id ? ` (id ${row.id})` : ''}`;

    if (!Number.isInteger(row?.id)) {
      errors.push(`${at}: id must be an integer`);
    } else if (ids.has(row.id)) {
      errors.push(`${at}: duplicate id`);
    } else {
      ids.add(row.id);
    }

    if (typeof row?.name !== 'string' || row.name.trim() === '') {
      errors.push(`${at}: name is required`);
    } else if (names.has(row.name)) {
      errors.push(`${at}: duplicate name "${row.name}"`);
    } else {
      names.add(row.name);
    }

    if (typeof row?.layer !== 'string' || row.layer.trim() === '') {
      errors.push(`${at}: layer is required`);
    }

    if (!priorities.has(row?.priority)) {
      errors.push(`${at}: priority must be one of ${[...priorities].join(', ')}`);
    }

    for (const field of ['invariant', 'break_it', 'tooling']) {
      if (typeof row?.[field] !== 'string' || row[field].trim() === '') {
        errors.push(`${at}: ${field} is required`);
      }
    }

    if (!Array.isArray(row?.assert) || row.assert.length === 0) {
      errors.push(`${at}: assert must be a non-empty list`);
    } else if (row.assert.some((item) => typeof item !== 'string' || item.trim() === '')) {
      errors.push(`${at}: every assert entry must be a non-empty string`);
    }
  });

  for (let id = 1; id <= 53; id += 1) {
    if (!ids.has(id)) errors.push(`missing id ${id}`);
  }
}

if (errors.length > 0) {
  console.error('Invariant matrix is invalid:\n');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const byPriority = rows.reduce((acc, row) => {
  acc[row.priority] = (acc[row.priority] ?? 0) + 1;
  return acc;
}, {});

const byLayer = rows.reduce((acc, row) => {
  acc[row.layer] = (acc[row.layer] ?? 0) + 1;
  return acc;
}, {});

console.log(`Validated ${rows.length} invariants.`);
console.log(`  priorities: ${Object.entries(byPriority).map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log(`  layers:     ${Object.entries(byLayer).map(([k, v]) => `${k}=${v}`).join(' ')}`);
