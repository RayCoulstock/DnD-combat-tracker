// Fixed built-in shader programs. All user-editable input is bounded uniform data.
const common=`
 uniform float time,alpha,pulse,detail,variant,secondary;
 uniform vec3 colour,accent;varying vec2 vP;
 const float PI=3.14159265;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
 float line(float d,float width){return 1.-smoothstep(width,width+max(fwidth(d),.002),abs(d));}
 float ring(float r,float target,float width){return line(r-target,width);}
 float beat(){return 1.-pulse*.3+pulse*.3*sin(time*1.8);}
 void outputColour(vec3 c,float a){gl_FragColor=vec4(c,a*alpha*beat());}
`
const finish=`
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`
export const portalFragment=common+`
 void main(){vec2 p=vP;float r=length(p),a=atan(p.y,p.x);if(r>1.04)discard;
 float swirl=sin(a*5.-r*15.+time*1.7+sin(r*9.-time));
 if(detail>.5)swirl+=.35*sin(a*11.+r*23.-time*2.);
 float rim=ring(r,.94,.045);float inner=(1.-smoothstep(.8,.94,r));
 float runes=ring(r,.81,.014)*step(.3,sin(a*18.+time*.4));
 float veins=pow(max(0.,swirl*.6+.25),3.)*inner;
 vec3 c=mix(colour*.2,accent,.3+.5*veins)+colour*rim*1.5+accent*runes;
 if(variant>1.5)c=mix(colour*.035,c,smoothstep(.2,.9,r));
 if(variant>.5&&variant<1.5)c+=accent*ring(r,.65+.02*sin(a*8.+time),.009);
 outputColour(c,clamp(inner*.82+rim+runes,0.,1.));
`+finish
export const circleFragment=common+`
 void main(){vec2 p=vP;float r=length(p),a=atan(p.y,p.x)+time*.12;if(r>1.02)discard;
 float bands=ring(r,.95,.012)+ring(r,.86,.009)+ring(r,.58,.012);
 float sector=mod(a+PI,2.*PI/12.)-PI/12.;
 vec2 glyph=vec2(sector*3.5,(r-.72)*7.);
 float marks=(line(glyph.x,.022)*step(abs(glyph.y),.39)+line(glyph.y-.16,.025)*step(abs(glyph.x),.22)+line(abs(glyph.x)-.19,.022)*step(abs(glyph.y),.22))*step(.61,r)*step(r,.82);
 float star=0.;
 if(variant>.5){float n=variant>1.5?5.:3.;star=line(r-(.32+.14*cos(a*n)),.012);bands+=ring(r,.45,.008);}
 if(detail<.5)marks*=.65;
 float energy=clamp(bands+marks+star,0.,1.);outputColour(mix(colour,accent,clamp(marks+star,0.,1.)),energy);
`+finish
export const corruptionFragment=common+`
 void main(){vec2 p=vP;float r=length(p);if(r>1.)discard;
 float n=noise(p*5.+vec2(time*.08,-time*.05));
 if(detail>.5)n=.65*n+.35*noise(p*12.-time*.06);
 float a=atan(p.y,p.x);float vein=pow(max(0.,1.-abs(sin(a*7.+n*5.+r*8.-time*.3))*6.),2.);
 float edge=(1.-smoothstep(.65,1.,r));float cracks=line(n-.5,.025)*edge;
 vec3 c=mix(colour*.15,accent,vein*.75+cracks*.5);
 float opacity=edge*(.35+vein*.6);
 if(variant>.5&&variant<1.5){c=mix(colour*.08,accent,vein*.6);opacity=edge*(.6+.25*sin(r*14.-time*1.5));}
 if(variant>1.5){c=mix(colour,accent,cracks);opacity=clamp(cracks+vein*.15,0.,1.)*edge;}
 outputColour(c,opacity);
`+finish
export const liquidFragment=common+`
 void main(){vec2 p=vP;float r=length(p);if(r>1.02)discard;
 float n=noise(p*4.+vec2(time*.1,-time*.07));
 if(detail>.5)n=.6*n+.4*noise(p*9.+time*.05);
 float boundary=1.-smoothstep(.88+.04*sin(atan(p.y,p.x)*7.),1.,r);
 float ripple=.5+.5*sin(r*25.-time*1.3+n*5.);
 vec3 c=mix(colour*.55,accent,.12+.35*n+.15*ripple);
 if(variant>1.5&&variant<2.5)c=mix(vec3(.12,.045,.018),mix(colour,accent,n),smoothstep(.37,.55,n));
 if(secondary>.5&&detail>.5){
 vec2 cell=floor(p*5.);vec2 q=fract(p*5.)-.5;float age=fract(time*.22+hash(cell));
 float bubbles=ring(length(q),age*.3,.025)*(1.-age)*step(.65,hash(cell+8.));c+=accent*bubbles*.7;
 }
 outputColour(c,boundary);
`+finish
