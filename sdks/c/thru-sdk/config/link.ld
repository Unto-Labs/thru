OUTPUT_ARCH(riscv)
ENTRY(_start)

MEMORY {
  rom : ORIGIN = 0x0, LENGTH = 16M
  ram : ORIGIN = 0x0, LENGTH = 16M
}

end = 0x0;

SECTIONS {
  .header : {
    BYTE(0x1)
    BYTE(0x0)
    BYTE(0x0)
    BYTE(0x0)
    BYTE(0x0)
    BYTE(0x0)
    BYTE(0x0)
    BYTE(0x0)
  }
  .text 0x8 : {
    *(.text._start)
    *(.text.start)
    *(.text)
    *(.text.*)
  } 
  .rodata : {
    *(.rodata)
    *(.rodata.*)
  } 
  .data : {
    *(.sdata)
    *(.data)
    *(.data.*)
  }
  .rodata_gap : {
    LONG(0x0)
  }

  /DISCARD/ : {
    *(.eh_frame)
    *(.note.GNU-stack)
    *(.comment)
    *(.riscv.attributes)
  }
}
