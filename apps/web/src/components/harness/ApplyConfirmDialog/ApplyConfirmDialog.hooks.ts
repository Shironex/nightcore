// ApplyConfirmDialog is a pure presentational confirm modal with no local state,
// effects, or queries — the `applying` flag and `error` are owned upstream in the
// HarnessView hook, and the shared <Modal> primitive owns the focus trap / Esc /
// Enter behavior. This module exists to satisfy the folder-per-component sibling
// contract and is the home for any future state this component grows.
export {};
