import { describe, expect, it } from 'vitest'
import { resolvePlaylistId } from '../lib/youtube'

describe('playlist configuration', () => {
  it('uses playlist id when no url is provided', () => {
    expect(resolvePlaylistId({
      playlistId: 'PLWAtCzJzHiz8e1itWCrJuMVqBDYUI6yd7',
    })).toBe('PLWAtCzJzHiz8e1itWCrJuMVqBDYUI6yd7')
  })

  it('extracts playlist id from a YouTube url', () => {
    expect(resolvePlaylistId({
      playlistId: 'wrong',
      playlistUrl: 'https://www.youtube.com/watch?v=PG1dNbGq1vQ&list=PLWAtCzJzHiz8e1itWCrJuMVqBDYUI6yd7',
    })).toBe('PLWAtCzJzHiz8e1itWCrJuMVqBDYUI6yd7')
  })
})
