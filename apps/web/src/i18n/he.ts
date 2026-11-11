// All the Hebrew word files as one download, fetched only when Hebrew is picked (index.ts).
type Words = Record<string, unknown>;
export default Object.assign({}, ...Object.values(import.meta.glob<Words>('./he/*.json', { eager: true, import: 'default' }))) as Words;
