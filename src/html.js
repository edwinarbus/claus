// Bind htm to React.createElement so components can use JSX-like template syntax
// with no build step. Everything imported from here is plain React.
import React from 'react';
import htm from 'htm';

export const html = htm.bind(React.createElement);
export { React };
export const {
  useState,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useMemo,
  useCallback,
  useContext,
  createContext,
  Fragment,
  memo,
} = React;
