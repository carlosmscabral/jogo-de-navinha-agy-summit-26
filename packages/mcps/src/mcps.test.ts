import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createWeaponsArsenalServer } from './weapons-arsenal.js';
import { createHullPropulsionServer } from './hull-propulsion.js';
import { createCyberneticsShieldsServer } from './cybernetics-shields.js';

describe('MCP Servers Creation and Tools Verification', () => {
  it('should instantiate weapons-arsenal MCP server', () => {
    const server = createWeaponsArsenalServer();
    assert.ok(server);
  });

  it('should instantiate hull-propulsion MCP server', () => {
    const server = createHullPropulsionServer();
    assert.ok(server);
  });

  it('should instantiate cybernetics-shields MCP server', () => {
    const server = createCyberneticsShieldsServer();
    assert.ok(server);
  });
});
