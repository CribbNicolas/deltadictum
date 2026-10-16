import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// The Markdown in ../docs, read in place: npm ships part of it and CLAUDE.md points into it.
// Ids keep the path and its case (docs/DD.md -> "DD"), since the URLs are case sensitive.
const docs = defineCollection({
  loader: glob({
    base: '../docs',
    pattern: ['**/*.md', '!superpowers/**', '!research/**', '!**/*.original.md', '!benchmarks/data/**'],
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    parent: z.string().optional(),
    nav_order: z.number().optional(),
    has_children: z.boolean().optional(),
  }),
});

export const collections = { docs };
