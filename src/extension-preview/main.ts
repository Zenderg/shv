import { mount } from 'svelte';
import PreviewApp from './PreviewApp.svelte';
import './preview.css';

mount(PreviewApp, {
  target: document.getElementById('app')!
});
