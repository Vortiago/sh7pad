// ID generators for the Creator's data model. Keeping a single source so
// the prefixes (and the random-suffix length) stay consistent.

const random = (): string => Math.random().toString(36).slice(2, 9);

export const newProjectId = (): string => `p_${random()}`;
export const newPointId = (): string => `pt_${random()}`;
export const newSegmentId = (): string => `s_${random()}`;
