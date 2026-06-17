# A Good Document

This document is intentionally free of the bugs `md-link-check` looks for, so it
can be used as a smoke test fixture.

## Heading slug algorithm

Every renderer produces the same slug for the same heading, so the anchor link
below will resolve correctly.

See the [heading slug algorithm](#heading-slug-algorithm) section.

## Images with alt text

A labelled image:

![Diagram of the slug algorithm](./diagram.png)

A decorative image is OK too — we don't flag it:

![](./spacer.png)

## Two headings that don't collide

These two slugs differ on purpose: `setup` vs `setup-advanced`.

### Setup

Steps go here.

### Setup Advanced

Advanced steps go here.
