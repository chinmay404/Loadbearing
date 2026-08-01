// What a component is allowed to be asked about.
//
// The point of a schema rather than a per-type list is that the wrong question stops
// being possible. These tests are mostly about absences: what a managed router must
// NOT offer, what anything that scales MUST offer, and that no component type can be
// added without inheriting a sensible set.

import { describe, expect, it } from 'vitest';
import { ARCH_NODE_TYPES } from './types.js';
import { familyOf, type Family } from './families.js';
import { GROUP_ORDER, PARAMS_BY_FAMILY, paramsFor } from './params.js';

const keysFor = (type: Parameters<typeof paramsFor>[0]) => paramsFor(type).map((p) => p.key);

describe('every component type', () => {
  it('has a parameter set, because every type has a family', () => {
    for (const type of ARCH_NODE_TYPES) {
      if (familyOf(type) === 'boundary') continue;
      expect(paramsFor(type).length, `${type} offers nothing`).toBeGreaterThan(0);
    }
  });

  it('never offers the same knob twice', () => {
    for (const [family, specs] of Object.entries(PARAMS_BY_FAMILY)) {
      const keys = specs.map((s) => s.key);
      expect(new Set(keys).size, `${family} repeats a parameter`).toBe(keys.length);
    }
  });

  it('puts every parameter in a group the inspector renders', () => {
    for (const specs of Object.values(PARAMS_BY_FAMILY)) {
      for (const spec of specs) expect(GROUP_ORDER).toContain(spec.group);
    }
  });

  it('explains what each one does, because a number with no meaning is worse than none', () => {
    for (const specs of Object.values(PARAMS_BY_FAMILY)) {
      for (const spec of specs) {
        expect(spec.label.length, `${spec.key} has no label`).toBeGreaterThan(2);
        expect(spec.hint.length, `${spec.key} has no hint`).toBeGreaterThan(20);
      }
    }
  });
});

describe('zone placement is offered only where it is a decision', () => {
  it('is not on a managed router', () => {
    // The complaint that started this: a load balancer with a multi-AZ toggle. Nobody
    // chooses that — a managed balancer is redundant by construction — so offering the
    // switch taught the wrong thing about what a design controls.
    for (const type of ['load_balancer', 'api_gateway', 'cdn', 'dns', 'reverse_proxy'] as const) {
      expect(keysFor(type), `${type} still offers multi-AZ`).not.toContain('multiAz');
    }
  });

  it('is on the things that hold state, where losing a zone loses data', () => {
    for (const type of ['sql_db', 'nosql_db', 'cache'] as const) {
      expect(keysFor(type)).toContain('multiAz');
    }
  });
});

describe('anything that scales says how far', () => {
  it('offers a floor and a ceiling on compute', () => {
    for (const type of ['service', 'worker', 'container_platform', 'serverless_fn'] as const) {
      expect(keysFor(type), `${type} cannot state a floor`).toContain('autoscaleMin');
      expect(keysFor(type), `${type} cannot state a ceiling`).toContain('autoscaleMax');
    }
  });

  it('offers shards on a datastore, which are not the same as replicas', () => {
    expect(keysFor('sql_db')).toContain('shards');
    expect(keysFor('sql_db')).toContain('replicas');
  });
});

describe('sizing, so capacity and cost come from one statement', () => {
  it('asks compute and datastores what the instance is', () => {
    for (const type of ['service', 'sql_db'] as const) {
      expect(keysFor(type)).toContain('vcpu');
      expect(keysFor(type)).toContain('memoryGb');
    }
  });

  it('asks a cache how much memory, since that is what a hit rate depends on', () => {
    expect(keysFor('cache')).toContain('memoryGb');
    expect(keysFor('cache')).toContain('cacheHitRate');
  });

  it('asks somebody else’s system for their price and their limit, not its size', () => {
    const external = keysFor('payment_gateway');
    expect(external).toContain('pricePerMillion');
    expect(external).toContain('rateLimitRps');
    expect(external, 'you do not size a third party').not.toContain('vcpu');
    expect(external, 'you do not scale a third party').not.toContain('autoscaleMax');
  });

  it('asks a model for tokens and token price, which is how inference is billed', () => {
    expect(keysFor('llm')).toContain('tokensPerRequest');
    expect(keysFor('llm')).toContain('pricePer1kTokens');
  });

  it('asks where traffic starts, on the things that can start it', () => {
    expect(keysFor('client')).toContain('trafficRps');
    expect(keysFor('scheduler')).toContain('trafficRps');
    expect(keysFor('sql_db'), 'a database is not where requests begin').not.toContain('trafficRps');
  });
});

describe('a component someone named themselves', () => {
  it('inherits the set of whatever it is based on', () => {
    // A custom object carries a baseType, so "Semantic Chunker" based on a chunker is
    // asked the compute questions and nothing else.
    expect(keysFor('chunker')).toEqual(keysFor('service'));
    expect(keysFor('custom')).toEqual(keysFor('service'));
  });
});

describe('the families themselves', () => {
  it('all have an entry, so adding one cannot be forgotten', () => {
    const families: Family[] = [
      'origin',
      'routing',
      'compute',
      'datastore',
      'cache',
      'messaging',
      'external',
      'ai',
      'control',
      'boundary',
    ];
    for (const family of families) expect(PARAMS_BY_FAMILY[family]).toBeDefined();
  });
});
