import { mount } from 'svelte';
import '../../ui/app.css';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
