import { describe, it, expect } from 'vitest';
import { parseTitleSegments } from '../src/shared/linkify';

const kinds = (title: string) => parseTitleSegments(title).map(s => s.kind);
const links = (title: string) =>
  parseTitleSegments(title).filter((s): s is Extract<typeof s, { kind: 'link' }> => s.kind === 'link').map(s => s.url);
const joined = (title: string) => parseTitleSegments(title).map(s => s.text).join('');

describe('parseTitleSegments', () => {
  it('returns a single text segment when there is no URL', () => {
    expect(parseTitleSegments('普通任务标题')).toEqual([{ kind: 'text', text: '普通任务标题' }]);
  });

  it('returns an empty array for an empty title', () => {
    expect(parseTitleSegments('')).toEqual([]);
  });

  it('extracts a URL at the end of a title', () => {
    expect(kinds('审查 https://github.com/x/y')).toEqual(['text', 'link']);
    expect(links('审查 https://github.com/x/y')).toEqual(['https://github.com/x/y']);
  });

  it('stops the token at CJK punctuation and keeps the prose as text', () => {
    const segs = parseTitleSegments('看https://a.b/c，然后回复');
    expect(kinds('看https://a.b/c，然后回复')).toEqual(['text', 'link', 'text']);
    expect(segs[1]).toEqual({ kind: 'link', text: 'https://a.b/c', url: 'https://a.b/c' });
    expect(segs[2]).toEqual({ kind: 'text', text: '，然后回复' });
    expect(segs[0]).toEqual({ kind: 'text', text: '看' });
  });

  it('trims trailing ASCII punctuation into the text segment', () => {
    expect(links('https://a.b/c.')).toEqual(['https://a.b/c']);
    expect(joined('https://a.b/c.')).toBe('https://a.b/c.');
  });

  it('keeps balanced parentheses inside the URL', () => {
    expect(links('wiki: https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual([
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    ]);
  });

  it('trims an unbalanced closing paren into the text', () => {
    expect(kinds('(see https://a.b/c)')).toEqual(['text', 'link', 'text']);
    expect(links('(see https://a.b/c)')).toEqual(['https://a.b/c']);
    expect(joined('(see https://a.b/c)')).toBe('(see https://a.b/c)');
  });

  it('handles multiple URLs in one title', () => {
    expect(links('a https://x.io/1 b https://y.io/2')).toEqual(['https://x.io/1', 'https://y.io/2']);
    expect(joined('a https://x.io/1 b https://y.io/2')).toBe('a https://x.io/1 b https://y.io/2');
  });

  it('keeps CJK path characters inside the URL', () => {
    expect(links('https://zh.wikipedia.org/wiki/机器学习')).toEqual([
      'https://zh.wikipedia.org/wiki/机器学习',
    ]);
  });

  it('does not emit a link for a bare scheme', () => {
    expect(kinds('https://，然后')).toEqual(['text']);
  });

  it('reconstructs the original title when segments are concatenated', () => {
    const title = '训练!! https://a.b/c（论文）. 备注';
    expect(joined(title)).toBe(title);
  });
});
