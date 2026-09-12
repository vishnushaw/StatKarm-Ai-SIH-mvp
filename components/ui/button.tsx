import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const buttonVariants = cva('inline-flex items-center justify-center rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:pointer-events-none disabled:opacity-50', { variants: { variant: { default: 'bg-[#f6c75d] text-[#1f3979] hover:bg-[#f0bd4c]', secondary: 'bg-[#edf1ff] text-brand hover:bg-[#e1e8ff]', ghost: 'text-brand hover:bg-[#edf1ff]', outline: 'border border-[#d7e0f1] bg-white text-brand hover:bg-[#f7f9ff]' }, size: { default: 'h-10 px-4', sm: 'h-8 px-3 text-xs', icon: 'h-9 w-9' } }, defaultVariants: { variant: 'default', size: 'default' } });
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => { const Comp = asChild ? Slot : 'button'; return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />; }); Button.displayName = 'Button'; export { Button, buttonVariants };
