/**
 * LRU map with a hard upper bound on the number of entries.
 *
 * Extends the native Map so all existing consumers (.get, .set, .delete,
 * .has, .keys, for-of, cast to Map<string, unknown>) work without changes.
 *
 * Eviction policy: when the map is full, the least-recently-used entry is
 * dropped. A .get() call moves the entry to the "most recent" end of the
 * insertion-order queue; this is implemented as delete + re-insert.
 *
 * Size limits chosen so peak memory stays well under 512 MB:
 *   - snapshotCache / readModelCache: 5 entries (fallback path, rarely used now)
 *   - workspaceResponseCache: 15 entries (~60 KB each)
 *   - bundleResponseCache: 15 entries (~120 KB each)
 *   - clusterTableResponseCache: 30 entries (~200 KB each)
 * Total upper bound: < 20 MB, vs. hundreds of MB with unbounded Maps.
 */
export class BoundedLruMap<K, V> extends Map<K, V> {
  constructor(private readonly maxSize: number) {
    super();
  }

  override set(key: K, value: V): this {
    if (this.has(key)) {
      super.delete(key);
    } else if (this.size >= this.maxSize) {
      const oldest = this.keys().next().value;
      if (oldest !== undefined) {
        super.delete(oldest);
      }
    }
    return super.set(key, value);
  }

  override get(key: K): V | undefined {
    const v = super.get(key);
    if (v !== undefined) {
      super.delete(key);
      super.set(key, v);
    }
    return v;
  }
}
