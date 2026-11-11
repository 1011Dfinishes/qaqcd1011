// Donato Plumbing - QA/QC Plumbing Rough-In: settings
'use strict';

// Floors in the app and how many units each one has. Units are numbered 1, 2, 3, ...
// To add a floor, add a line here (and keep them in order).
const FLOORS = [
  { floor: 2, units: 19 },
  { floor: 6, units: 32 },
  { floor: 7, units: 29 }
];

// Shown until the address has been loaded from the server.
const DEFAULT_LOCATION = '1011 1st AVE';

// Supabase project (the same one the Finishes app uses; the rough-in data is in its own tables).
// The key below is the project's public (anon) key: it is meant to be in the app.
// What people can do is enforced by the database rules, not by this key.
const SB_URL = 'https://udburardbmxfozcfimms.supabase.co';
const BUCKET = 'roughin';          // photos of deficiencies go here (a separate bucket from the Finishes photos)
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkYnVyYXJkYm14Zm96Y2ZpbW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwNjM1MjYsImV4cCI6MjEwOTYzOTUyNn0.LsgQXtIWs1JFjn_k5QTtM1x_CvY9N0ulivjhp5RoYpY';
