import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import type { RelationRecord } from '../store/repositories/relation.repository';
import { DependencyGraph } from './dependency-graph';
import type { IDependencyGraphRepo } from './dependency-graph';

const PROJECT = 'test-project';

const filePathArbitrary = fc.stringMatching(/^\/[a-zA-Z][a-zA-Z0-9_]{0,9}\.ts$/);

const edgeArbitrary = fc.record({
  src: filePathArbitrary,
  dst: filePathArbitrary,
});

const edgesArbitrary = fc.array(edgeArbitrary);

function makeRelation(src: string, dst: string): RelationRecord {
  return {
    project: PROJECT,
    type: 'imports',
    srcFilePath: src,
    srcSymbolName: null,
    dstProject: PROJECT,
    dstFilePath: dst,
    dstSymbolName: null,
    metaJson: null,
    specifier: null,
    isExternal: 0,
  };
}

function buildGraphFromEdges(edges: Array<{ src: string; dst: string }>): DependencyGraph {
  const relations = edges.map(e => makeRelation(e.src, e.dst));
  const repo: IDependencyGraphRepo = {
    getByType(_project: string, _type: string): RelationRecord[] {
      return relations;
    },
  };
  const graph = new DependencyGraph({ relationRepo: repo, project: PROJECT });
  graph.build();
  return graph;
}

describe('DependencyGraph (property-based)', () => {
  it('should satisfy hasCycle() === (getCyclePaths().length > 0) for any graph', () => {
    fc.assert(
      fc.property(edgesArbitrary, (edges) => {
        const graph = buildGraphFromEdges(edges);

        const hasCycle = graph.hasCycle();
        const cyclePaths = graph.getCyclePaths();

        expect(hasCycle).toBe(cyclePaths.length > 0);
      }),
    );
  });

  it('should include C in getTransitiveDependencies(A) when A->B->C chain exists', () => {
    fc.assert(
      fc.property(edgesArbitrary, (extraEdges) => {
        const a = '/a.ts';
        const b = '/b.ts';
        const c = '/c.ts';

        const edges = [
          { src: a, dst: b },
          { src: b, dst: c },
          ...extraEdges,
        ];

        const graph = buildGraphFromEdges(edges);
        const transitiveDeps = graph.getTransitiveDependencies(a);

        expect(transitiveDeps).toContain(c);
      }),
    );
  });

  it('should return getAffectedByChange([A]) as superset of getTransitiveDependents(A) for any node A', () => {
    fc.assert(
      fc.property(
        edgesArbitrary.filter(edges => edges.length > 0),
        (edges) => {
          const graph = buildGraphFromEdges(edges);

          // Pick the first source node from the edges
          const nodeA = edges[0]!.src;

          const affected = new Set(graph.getAffectedByChange([nodeA]));
          const transitiveDependents = graph.getTransitiveDependents(nodeA);

          for (const dep of transitiveDependents) {
            expect(affected.has(dep)).toBe(true);
          }
        },
      ),
    );
  });

  it('should produce identical adjacency list after patchFiles with same data as fresh build', () => {
    fc.assert(
      fc.property(edgesArbitrary, (edges) => {
        // Build the reference graph from scratch
        const referenceGraph = buildGraphFromEdges(edges);
        const referenceAdjacency = referenceGraph.getAdjacencyList();

        // Build a graph, then patch all files with the same relations
        const patchGraph = buildGraphFromEdges(edges);

        const allFiles = new Set<string>();
        for (const e of edges) {
          allFiles.add(e.src);
          allFiles.add(e.dst);
        }
        const changedFiles = Array.from(allFiles);

        const relationsForFile = (filePath: string) =>
          edges
            .filter(e => e.src === filePath)
            .map(e => ({ srcFilePath: e.src, dstFilePath: e.dst }));

        patchGraph.patchFiles(changedFiles, [], relationsForFile);
        const patchedAdjacency = patchGraph.getAdjacencyList();

        // Compare: both maps should have the same keys with the same sorted values
        expect(patchedAdjacency.size).toBe(referenceAdjacency.size);

        for (const [node, deps] of referenceAdjacency) {
          const patchedDeps = patchedAdjacency.get(node);
          expect(patchedDeps).toBeDefined();
          expect([...patchedDeps!].sort()).toEqual([...deps].sort());
        }

        // Verify patched has no extra keys beyond reference
        for (const [node] of patchedAdjacency) {
          expect(referenceAdjacency.has(node)).toBe(true);
        }
      }),
    );
  });

  it('should detect cycle when a self-loop A->A exists', () => {
    fc.assert(
      fc.property(
        filePathArbitrary,
        edgesArbitrary,
        (selfLoopNode, extraEdges) => {
          const edges = [
            { src: selfLoopNode, dst: selfLoopNode },
            ...extraEdges,
          ];

          const graph = buildGraphFromEdges(edges);

          expect(graph.hasCycle()).toBe(true);
        },
      ),
    );
  });

  it('should return only valid cycles from getCyclePaths where each step is a real edge', () => {
    fc.assert(
      fc.property(edgesArbitrary, (edges) => {
        const graph = buildGraphFromEdges(edges);
        const cyclePaths = graph.getCyclePaths();

        for (const cycle of cyclePaths) {
          // Each cycle must have at least 1 node
          expect(cycle.length).toBeGreaterThanOrEqual(1);
          // Verify adjacency: each consecutive pair must be connected
          for (let i = 0; i < cycle.length; i++) {
            const from = cycle[i]!;
            const to = cycle[(i + 1) % cycle.length]!;
            const deps = graph.getDependencies(from);
            expect(deps).toContain(to);
          }
        }
      }),
    );
  });

  it('should report no cycles and no dependencies for an empty graph', () => {
    const graph = buildGraphFromEdges([]);
    expect(graph.hasCycle()).toBe(false);
    expect(graph.getCyclePaths()).toEqual([]);
    expect(graph.getAdjacencyList().size).toBe(0);
  });
});
