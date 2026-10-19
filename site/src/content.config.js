import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { OFF_SITE } from './config.js';

// The Markdown in ../docs, read in place: npm ships part of it and CLAUDE.md points into it.
// Ids keep the path and its case (docs/DD.md -> "DD"), since the URLs are case sensitive.
const docs = defineCollection({
  loader: glob({
    base: '../docs',
    pattern: ['**/*.md', ...OFF_SITE.map(folder => `!${folder}/**`), '!**/*.original.md'],
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
