package domain

// Page is a cursor-paginated projection: the items of one page plus the cursor
// for the next page (nil when there is none). The pair owns the data and the
// ordering; this struct only models the shape the BFF reads back and re-emits.
type Page[T any] struct {
	Items []T     `json:"items"`
	Next  *string `json:"next"`
}
