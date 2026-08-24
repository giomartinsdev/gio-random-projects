package post

import "testing"

func TestNew(t *testing.T) {
	t.Run("positive: valid input creates a draft by default", func(t *testing.T) {
		p, err := New("id-1", "author-1", "Title", "slug", "body", "", "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p.Status != "draft" {
			t.Errorf("status = %q, want draft", p.Status)
		}
		if p.Type != "article" {
			t.Errorf("type = %q, want article", p.Type)
		}
		if p.PublishedAt != nil {
			t.Errorf("expected PublishedAt nil for a draft")
		}
	})

	t.Run("positive: published status sets PublishedAt", func(t *testing.T) {
		p, err := New("id-1", "author-1", "Title", "slug", "body", "article", "published")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p.PublishedAt == nil {
			t.Errorf("expected PublishedAt to be set for a published post")
		}
	})

	t.Run("negative: missing author_id", func(t *testing.T) {
		_, err := New("id-1", "", "Title", "slug", "body", "", "")
		if err != ErrAuthorRequired {
			t.Errorf("err = %v, want ErrAuthorRequired", err)
		}
	})

	t.Run("negative: missing title", func(t *testing.T) {
		_, err := New("id-1", "author-1", "", "slug", "body", "", "")
		if err != ErrTitleRequired {
			t.Errorf("err = %v, want ErrTitleRequired", err)
		}
	})

	t.Run("negative: missing body", func(t *testing.T) {
		_, err := New("id-1", "author-1", "Title", "slug", "", "", "")
		if err != ErrBodyRequired {
			t.Errorf("err = %v, want ErrBodyRequired", err)
		}
	})

	t.Run("negative: invalid type", func(t *testing.T) {
		_, err := New("id-1", "author-1", "Title", "slug", "body", "video", "")
		if err != ErrInvalidType {
			t.Errorf("err = %v, want ErrInvalidType", err)
		}
	})

	t.Run("negative: invalid status", func(t *testing.T) {
		_, err := New("id-1", "author-1", "Title", "slug", "body", "", "archived")
		if err != ErrInvalidStatus {
			t.Errorf("err = %v, want ErrInvalidStatus", err)
		}
	})
}

func TestEdit(t *testing.T) {
	t.Run("positive: owner edits title", func(t *testing.T) {
		p, _ := New("id-1", "author-1", "Original", "slug", "body", "", "")
		if err := p.Edit("author-1", "New Title", "", "", "", ""); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p.Title != "New Title" {
			t.Errorf("title = %q, want New Title", p.Title)
		}
	})

	t.Run("negative: non-owner is forbidden", func(t *testing.T) {
		p, _ := New("id-1", "author-1", "Original", "slug", "body", "", "")
		err := p.Edit("someone-else", "New Title", "", "", "", "")
		if err != ErrForbidden {
			t.Errorf("err = %v, want ErrForbidden", err)
		}
	})

	t.Run("edge: empty fields leave existing values unchanged", func(t *testing.T) {
		p, _ := New("id-1", "author-1", "Original", "slug", "body", "", "")
		if err := p.Edit("author-1", "", "", "", "", ""); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p.Title != "Original" {
			t.Errorf("title changed unexpectedly to %q", p.Title)
		}
	})

	t.Run("edge: transitioning draft to published sets PublishedAt once", func(t *testing.T) {
		p, _ := New("id-1", "author-1", "Original", "slug", "body", "", "draft")
		if err := p.Edit("author-1", "", "", "", "", "published"); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p.PublishedAt == nil {
			t.Fatalf("expected PublishedAt to be set")
		}
		first := *p.PublishedAt
		if err := p.Edit("author-1", "Tweak", "", "", "", "published"); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !p.PublishedAt.Equal(first) {
			t.Errorf("PublishedAt changed on a second publish; want it to stay fixed at first publish time")
		}
	})
}
