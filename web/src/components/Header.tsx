import { useRef, useState } from "react";
import type { GeolocationStatus } from "../hooks/useGeolocation";
import type { GeocodeResult } from "../api";

interface HeaderProps {
  originStatus: GeolocationStatus;
  onLocate: () => void;
  destinationQuery: string;
  onDestinationQueryChange: (value: string) => void;
  suggestions: GeocodeResult[];
  onSelectDestination: (result: GeocodeResult) => void;
  onClearDestination: () => void;
  hasDestination: boolean;
}

const QUICK_DESTINATIONS = ["Copacabana", "Centro", "Ipanema", "Barra da Tijuca"];

export function Header({
  originStatus,
  onLocate,
  destinationQuery,
  onDestinationQueryChange,
  suggestions,
  onSelectDestination,
  onClearDestination,
  hasDestination,
}: HeaderProps) {
  const [inputFocused, setInputFocused] = useState(false);
  const destinationInputRef = useRef<HTMLInputElement>(null);
  const showSuggestions = inputFocused && suggestions.length > 0;

  function handleQuickDestination(label: string) {
    onDestinationQueryChange(label);
    destinationInputRef.current?.focus();
  }

  return (
    <header className="app-header">
      <div className="brand-row">
        <div className="mark">
          <div className="app-icon">
            <svg className="icon" style={{ width: 18, height: 18 }}>
              <use href="#icon-bus" />
            </svg>
          </div>
          <div className="wordmark">
            bora<span className="dot">.</span>
          </div>
        </div>
        <div className="city-pill">Rio de Janeiro</div>
      </div>

      {/* .route-bar itself needs overflow:hidden to round its own
          corners around the two route-rows — but that same property
          would clip the suggestions dropdown, which has to render
          BELOW the box, not inside it. Confirmed live: the dropdown was
          in the DOM with the right content and a real bounding box, just
          invisible, clipped by its own parent's overflow. This wrapper
          is what .suggestions positions against instead, so it escapes
          that clip. */}
      <div className="route-bar-wrap">
        <div className="route-bar">
          <div className="route-row">
            <span className="route-dot origin">
              <svg className="icon">
                <use href="#icon-crosshair" />
              </svg>
            </span>
            <input
              type="text"
              readOnly
              value={originStatusLabel(originStatus)}
              placeholder="Sua localização"
            />
            <button
              className={`gps${originStatus === "locating" ? " busy" : ""}`}
              type="button"
              onClick={onLocate}
              aria-label="Usar minha localização"
            >
              <svg className="icon">
                <use href="#icon-crosshair" />
              </svg>
            </button>
          </div>
          <div className="route-row">
            <span className="route-dot dest">
              <svg className="icon">
                <use href="#icon-pin" />
              </svg>
            </span>
            <input
              ref={destinationInputRef}
              type="text"
              value={destinationQuery}
              onChange={(event) => onDestinationQueryChange(event.target.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setTimeout(() => setInputFocused(false), 120)}
              placeholder="Para onde você vai?"
              autoComplete="off"
            />
            {hasDestination && (
              <button
                className="clear-dest"
                type="button"
                onClick={onClearDestination}
                aria-label="Limpar destino"
              >
                <svg className="icon">
                  <use href="#icon-x" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {showSuggestions && (
          <div className="suggestions">
            {suggestions.map((result) => (
              <button
                key={`${result.latitude},${result.longitude}`}
                className="suggestion-item"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelectDestination(result)}
              >
                <svg className="icon">
                  <use href="#icon-pin" />
                </svg>
                {result.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {originStatus === "denied" && (
        <div className="origin-status error">
          Localização negada — permita o acesso para ver linhas perto de você.
        </div>
      )}

      {!hasDestination && (
        <div className="chips">
          {QUICK_DESTINATIONS.map((label) => (
            <button
              key={label}
              className="chip"
              type="button"
              onClick={() => handleQuickDestination(label)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}

function originStatusLabel(status: GeolocationStatus): string {
  switch (status) {
    case "ready":
      return "Sua localização atual";
    case "locating":
      return "Localizando…";
    case "denied":
      return "Localização não permitida";
    case "unavailable":
      return "Localização indisponível";
    default:
      return "";
  }
}
