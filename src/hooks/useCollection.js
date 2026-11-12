import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../firebase";
import { readLocalCache, writeLocalCache } from "../lib/cache";

export function collectionCacheName(collectionName, options = {}) {
  return [
    "collection",
    collectionName,
    options.messId || "global",
    options.cycleId || "all",
    options.orderBy || "none",
    options.orderDirection || "asc",
  ].join(":");
}

export function useCollection(collectionName, options = {}) {
  const cacheName = collectionCacheName(collectionName, options);
  const [rows, setRows] = useState(() => readLocalCache(cacheName, []));
  const [loading, setLoading] = useState(true);
  const [serverSynced, setServerSynced] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const cachedRows = readLocalCache(cacheName, []);
    setRows(cachedRows);
    setServerSynced(false);
    setError(null);

    if (!db || options.skip) {
      setRows([]);
      setLoading(false);
      setServerSynced(true);
      return undefined;
    }

    const clauses = [];
    if (options.messId) clauses.push(where("messId", "==", options.messId));
    if (options.cycleId) clauses.push(where("cycleId", "==", options.cycleId));
    if (options.orderBy && !options.cycleId && !options.messId) clauses.push(orderBy(options.orderBy, options.orderDirection || "asc"));
    const q = clauses.length ? query(collection(db, collectionName), ...clauses) : collection(db, collectionName);

    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        const nextRows = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
        if (options.orderBy && (options.cycleId || options.messId)) {
          nextRows.sort((a, b) => {
            const left = a[options.orderBy] || "";
            const right = b[options.orderBy] || "";
            return options.orderDirection === "desc" ? String(right).localeCompare(String(left)) : String(left).localeCompare(String(right));
          });
        }
        setRows(nextRows);
        if (!snap.metadata.fromCache) {
          writeLocalCache(cacheName, nextRows);
          setServerSynced(true);
        }
        setLoading(false);
      },
      (snapshotError) => {
        console.error(`${collectionName} listener failed`, snapshotError);
        setError(snapshotError);
        setRows(cachedRows);
        setLoading(false);
      },
    );
  }, [cacheName, collectionName, options.cycleId, options.messId, options.orderBy, options.orderDirection, options.retryToken, options.skip]);

  return { rows, error, loading, serverSynced };
}
