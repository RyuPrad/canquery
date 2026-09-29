import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import SearchBar from './SearchBar.jsx';

test('search has an accessible name after text replaces its placeholder', () => {
  render(<SearchBar value="water" onChange={() => {}} placeholder="Find water datasets" />);
  expect(screen.getByRole('searchbox', { name: 'Find water datasets' })).toHaveValue('water');
});
