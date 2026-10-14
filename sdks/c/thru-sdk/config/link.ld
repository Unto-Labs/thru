OUTPUT_ARCH(riscv)
ENTRY(_start)

MEMORY {
  rom : ORIGIN = 0x0, LENGTH = 16M
  ram : ORIGIN = 0x3000000, LENGTH = 16M
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
  /* Every loaded section keeps the .text offset between its address and
     its load address: the program is loaded as one flat image, so a
     section whose alignment (e.g. 16 bytes for 128-bit constants) rounds
     its address and its load address differently would load shifted. */
  .text 0x3000000 : AT(0x08) {
    *(.text._start)
    *(.text.start)
    *(.text)
    *(.text.*)
  } 
  .rodata : AT( LOADADDR( .text ) + ADDR( .rodata ) - ADDR( .text ) ) {
    *(.rodata)
    *(.rodata.*)
  } 
  .data : AT( LOADADDR( .text ) + ADDR( .data ) - ADDR( .text ) ) {
    *(.sdata)
    *(.data)
    *(.data.*)
  }
  .rodata_gap : AT( LOADADDR( .text ) + ADDR( .rodata_gap ) - ADDR( .text ) ) {
    QUAD(0x0)
  }

  /DISCARD/ : {
    *(.eh_frame)
    *(.note.GNU-stack)
    *(.comment)
    *(.riscv.attributes)
  }
}
