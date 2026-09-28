// Setup dos testes de componente (Vitest + jsdom).
//
// `jest-dom` acrescenta os matchers de DOM (toBeInTheDocument, toHaveTextContent
// etc). O `matchMedia` não existe no jsdom e o tema/alguns componentes o
// consultam -- sem o stub, um teste que renderiza o shell estoura num erro que
// não tem nada a ver com o que ele testa.
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());

if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// O jsdom não implementa scrollTo; a navegação chama window.scrollTo.
window.scrollTo = vi.fn();
